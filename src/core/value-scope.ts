/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
	signal as createSignal,
	computed,
	effect,
	type ReadonlySignal,
} from './signal.js';
import { subscribeFireOnly } from './utils/effect-helpers.js';
import { buildScopeDefinition } from './scope-definition.js';
import { InstanceStore } from './instance-store.js';
import {
	FieldValue,
	FieldValueSchema,
	FieldValuePlain,
	FieldDerived,
	FieldAsyncDerived,
	DerivationWrap,
	brandAsScope,
} from './field-value.js';
import {
	initialAsyncState,
	settingAsyncState,
	resolvedAsyncState,
	errorAsyncState,
} from './async-state.js';
import { ScopeMap } from './scope-map.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';
import { mergeConfigs, type ScopeConfig } from './scope-config.js';
import { walkRefCollect, walkRefTrack, walkRefValid } from './ref-walk.js';
import type { ScopeDefinitionMeta, GroupMeta } from './slot-meta.js';
import type { ScopeNode, Unsubscribe } from './types.js';
import type {
	ScopeInstance,
	ValueInputOf,
	ExtendDef,
	GenericScopeInstance,
	ScopeValidationResult,
} from './scope-types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

// --- ScopeTemplate ---

/**
 * A scope template. Call `.create()` to produce live instances.
 *
 * @remarks
 * A `ScopeTemplate` is a reusable blueprint for creating reactive scope instances.
 * It encapsulates the definition and configuration, allowing you to instantiate
 * multiple independent copies of the same state structure.
 *
 * @typeParam Def - the raw definition record, used to infer instance types.
 *
 * @see {@link valueScope} factory function for creating templates.
 * @see {@link ScopeInstance} for the instance API.
 */
export class ScopeTemplate<
	Def extends Record<string, unknown> = Record<string, unknown>,
> {
	readonly #definition: ScopeDefinitionMeta;
	readonly #rawDefinition: Record<string, unknown>;
	readonly #config: ScopeConfig | undefined;

	/** @internal */
	constructor(rawDefinition: Record<string, unknown>, config?: ScopeConfig) {
		this.#rawDefinition = rawDefinition;
		this.#definition = buildScopeDefinition(rawDefinition);
		this.#config = config;
	}

	/**
	 * Create a live scope instance.
	 *
	 * @param input - optional initial values for fields declared in the definition.
	 * @returns a new {@link ScopeInstance}.
	 *
	 * @example
	 * ```ts
	 * const user = userTemplate.create({ name: "Alice", age: 30 });
	 * ```
	 */
	create(input?: Partial<ValueInputOf<Def>>): ScopeInstance<Def> {
		return createScopeInstance(
			this.#definition,
			this.#rawDefinition,
			this.#config,
			input,
		) as unknown as ScopeInstance<Def>;
	}

	/**
	 * Create a new template with additional fields. Lifecycle hooks are merged
	 * so both base and extension hooks fire in order.
	 *
	 * @remarks
	 * Use `undefined` as a value in the extension to remove a field from the base definition.
	 *
	 * @typeParam Ext - the extension definition record.
	 * @param extension - additional fields to add to the definition.
	 * @param extensionConfig - optional lifecycle hooks for the extended scope.
	 * @returns a new {@link ScopeTemplate} combining base and extension.
	 *
	 * @example
	 * ```ts
	 * const employeeTemplate = personTemplate.extend({
	 *   salary: value(50000),
	 *   isHired: true,
	 * });
	 * ```
	 */
	extend<Ext extends Record<string, unknown>>(
		extension: Ext,
		extensionConfig?: ScopeConfig,
	): ScopeTemplate<ExtendDef<Def, Ext>> {
		// Merge definitions: extension overrides base, undefined removes
		const mergedDefinition: Record<string, unknown> = {
			...this.#rawDefinition,
		};
		for (const [key, value] of Object.entries(extension)) {
			if (value === undefined) {
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete mergedDefinition[key];
			} else {
				mergedDefinition[key] = value;
			}
		}

		// Merge configs
		const mergedConfig = mergeConfigs(this.#config, extensionConfig);
		return new ScopeTemplate(mergedDefinition, mergedConfig);
	}

	/**
	 * Create a keyed collection of scope instances.
	 *
	 * @example Empty collection
	 * ```ts
	 * const users = userTemplate.createMap<number>();
	 * users.set(1, { name: "Alice" });
	 * ```
	 *
	 * @example From an array, keyed by field name
	 * ```ts
	 * const users = userTemplate.createMap(apiResponse, 'id');
	 * ```
	 *
	 * @example From an array, keyed by callback
	 * ```ts
	 * const users = userTemplate.createMap(apiResponse, (item) => item.id);
	 * ```
	 *
	 * @example From a Map
	 * ```ts
	 * const users = userTemplate.createMap(new Map([['alice', { name: 'Alice' }]]));
	 * ```
	 */
	createMap<K extends string | number = string | number>(): ScopeMap<K, Def>;
	createMap<K extends string | number>(
		data: Partial<ValueInputOf<Def>>[],
		keyField: keyof ValueInputOf<Def> & string,
	): ScopeMap<K, Def>;
	createMap<K extends string | number>(
		data: Partial<ValueInputOf<Def>>[],
		// eslint-disable-next-line @typescript-eslint/unified-signatures
		keyFn: (item: Partial<ValueInputOf<Def>>) => K,
	): ScopeMap<K, Def>;
	createMap<K extends string | number>(
		// eslint-disable-next-line @typescript-eslint/unified-signatures
		data:
			| Map<K, Partial<ValueInputOf<Def>>>
			| [K, Partial<ValueInputOf<Def>>][],
	): ScopeMap<K, Def>;
	createMap<K extends string | number = string | number>(
		data?:
			| Map<K, Partial<ValueInputOf<Def>>>
			| [K, Partial<ValueInputOf<Def>>][]
			| Partial<ValueInputOf<Def>>[],
		keyFieldOrFn?:
			| (keyof ValueInputOf<Def> & string)
			| ((item: Partial<ValueInputOf<Def>>) => K),
	): ScopeMap<K, Def> {
		const map = new ScopeMap<K, Def>(this);
		if (!data) return map;

		if (Array.isArray(data) && keyFieldOrFn !== undefined) {
			// Array + field name or callback
			const items = data as Partial<ValueInputOf<Def>>[];
			for (const [i, item] of items.entries()) {
				const key: K | undefined =
					typeof keyFieldOrFn === 'function' ?
						keyFieldOrFn(item)
					:	(item[keyFieldOrFn as keyof typeof item] as K | undefined);
				if (key === undefined) {
					// Without this check, every item with a missing key would
					// collapse onto the same `undefined` slot and N items
					// would become 1 entry, silently.
					const where =
						typeof keyFieldOrFn === 'function' ?
							`key callback returned undefined`
						:	`keyField "${keyFieldOrFn}" is missing`;
					throw new Error(
						`createMap: ${where} for item at index ${String(i)}.`,
					);
				}
				map.set(key, item);
			}
		} else if (data instanceof Map) {
			for (const [key, value] of data.entries()) {
				map.set(key, value);
			}
		} else if (Array.isArray(data)) {
			// Array of [key, input] tuples
			for (const entry of data) {
				const [key, value] = entry as [K, Partial<ValueInputOf<Def>>];
				map.set(key, value);
			}
		}

		return map;
	}
}

/**
 * Define a reactive scope.
 *
 * @remarks
 * A scope is a collection of reactive values, derivations, and nested scopes.
 * It provides a structured way to manage complex state with built-in change tracking,
 * lifecycle hooks, and React integration.
 *
 * @typeParam Def - the scope definition record.
 * @param definition - a definition tree with `value()`, functions, plain objects, and static data.
 * @param config - optional lifecycle hooks.
 * @returns a {@link ScopeTemplate} with `.create()`.
 *
 * @example
 * ```ts
 * const person = valueScope({
 *   first: value("Alice"),
 *   last: value("Smith"),
 *   full: ({ scope }) => `${scope.first.use()} ${scope.last.use()}`,
 * });
 * const alice = person.create();
 * alice.first.get(); // "Alice"
 * alice.full.get();  // "Alice Smith"
 * ```
 */
export function valueScope<Def extends Record<string, unknown>>(
	definition: Def,
	config?: ScopeConfig,
): ScopeTemplate<Def> {
	return new ScopeTemplate(definition, config);
}

// --- Instance creation ---

/**
 * Fire the `onCreate` lifecycle hook with a fresh `AbortController` whose
 * signal aborts when the scope is destroyed (or, in the `$setSnapshot
 * recreate` path, when the next recreate cycle starts). The controller is
 * created unconditionally so the lifecycle-cleanups list always grows by
 * exactly one entry — keeps the create / recreate paths symmetric.
 * @internal
 */
function fireOnCreate(
	config: ScopeConfig | undefined,
	instance: Record<string, unknown>,
	input: Record<string, unknown> | undefined,
	lifecycleCleanups: (() => void)[],
): void {
	const controller = new AbortController();
	lifecycleCleanups.push(() => {
		controller.abort();
	});
	if (config?.onCreate) {
		config.onCreate({
			scope: instance as GenericScopeInstance,
			input,
			signal: controller.signal,
			onCleanup: (fn) => lifecycleCleanups.push(fn),
		});
	}
}

function createScopeInstance(
	definition: ScopeDefinitionMeta,
	_rawDefinition: Record<string, unknown>,
	config: ScopeConfig | undefined,
	input: Record<string, unknown> | undefined,
): Record<string, unknown> {
	// Resolve initial values from input (flattened path -> value)
	const initialValues = new Map<number, unknown>();
	if (input) {
		resolveInputValues(definition, input, '', initialValues);
	}

	// Create the InstanceStore
	const store = new InstanceStore(definition, initialValues);

	// Build derivation scope tree (per-instance for now)
	const derivationScope = buildDerivationScopeTree(definition, store);

	// Resolve ValueRef entries: factory refs create per-instance sources,
	// shared refs just attach the existing source.
	// Must happen before derivation setup so derivations can reference refs.
	const factoryRefInstances: Record<string, unknown>[] = [];
	// Factory-created reactive primitives (Value / ValueSet / ValueMap /
	// ValueArray) expose `.destroy()` rather than `$destroy`. They were
	// previously leaked on parent destroy because the propagation block only
	// looked for `$destroy`. Track them here so they can be torn down too.
	const factoryRefDestroyables: { destroy: () => void }[] = [];
	// Refs that participate in transitive onUsed/onUnused — i.e. anything
	// with a `$subscribe` (scope instances), shared or factory-created.
	// Plain Value/Set/Map refs aren't lifecycle owners and are skipped.
	const transitiveLifecycleRefs: Record<string, unknown>[] = [];
	const resolvedRefs = new Map<string, unknown>();
	for (const [path, ref] of definition.refEntries) {
		let resolved: unknown;
		if (ref.factory) {
			resolved = ref.factory();
			// Track factory-created scope instances for destroy propagation
			if (
				typeof resolved === 'object' &&
				resolved !== null &&
				'$destroy' in resolved
			) {
				factoryRefInstances.push(resolved);
			} else if (
				typeof resolved === 'object' &&
				resolved !== null &&
				'destroy' in resolved &&
				typeof resolved.destroy === 'function'
			) {
				factoryRefDestroyables.push(resolved as { destroy: () => void });
			}
		} else {
			resolved = ref.source;
		}
		if (
			typeof resolved === 'object' &&
			resolved !== null &&
			'$subscribe' in resolved &&
			typeof resolved.$subscribe === 'function'
		) {
			transitiveLifecycleRefs.push(resolved);
		}
		resolvedRefs.set(path, resolved);
		// Attach to derivation scope for use in derivations. Wrap with a
		// DerivationWrap-compatible interface so `.use()` inside a derivation
		// performs the right kind of tracked read for each source shape.
		const wrapped = wrapRefForDerivation(resolved);
		setNestedValue(derivationScope, path, wrapped ?? resolved);
	}

	// Build the instance object tree
	const nodesBySlot = new Map<number, ScopeNode>();
	const nodesByGroup = new Map<number, ScopeNode>();
	const instance = buildInstanceTree(
		definition,
		store,
		nodesBySlot,
		nodesByGroup,
	);

	// Register the instance tree in the store for change tracking
	store.registerTree(instance, nodesBySlot, nodesByGroup);

	// Two buckets of disposers. Both fire on $destroy; only `lifecycleCleanups`
	// is replayed by `$setSnapshot(..., { recreate: true })`, which models a
	// fresh onDestroy → onCreate cycle without rebuilding the per-instance
	// derivation infrastructure. Mixing them caused recreate to silently kill
	// every sync/async derivation on the instance.
	const instanceCleanups: (() => void)[] = [];
	const lifecycleCleanups: (() => void)[] = [];

	// Set up sync derivations
	setupSyncDerivations(definition, store, derivationScope, instanceCleanups);

	// Set up async derivations
	setupAsyncDerivations(
		definition,
		store,
		initialValues,
		resolvedRefs,
		instanceCleanups,
	);

	// Attach static entries (must run before child groups are frozen)
	attachStaticEntries(definition, instance);

	// Attach resolved refs to the instance tree
	for (const [path, resolved] of resolvedRefs) {
		setNestedValue(instance, path, resolved);
	}

	// Preserve undeclared properties from input as plain data
	const undeclaredProperties = new Map<string, unknown>();
	if (config?.allowUndeclaredProperties && input) {
		collectUndeclaredProperties(definition, input, '', undeclaredProperties);
		for (const [path, value] of undeclaredProperties) {
			setNestedValue(instance, path, value);
		}
	}

	// Freeze child groups now that all their content (wrappers + static) is present.
	freezeChildGroups(definition, nodesByGroup);

	// Attach $ methods
	attachDollarMethods(
		instance,
		store,
		definition,
		config,
		instanceCleanups,
		lifecycleCleanups,
		undeclaredProperties,
		factoryRefInstances,
		factoryRefDestroyables,
	);

	// Set up validate config and $getIsValid/$useIsValid
	setupValidation(
		instance,
		store,
		definition,
		config,
		derivationScope,
		instanceCleanups,
		resolvedRefs,
	);

	// Brand as scope
	brandAsScope(instance);

	// Wire hooks
	if (config?.onChange) {
		const onChange = config.onChange;
		store.onChangeHook = (context) => {
			onChange(context);
		};
	}

	if (config?.beforeChange) {
		const beforeChange = config.beforeChange;
		store.beforeChangeHook = (context) => {
			beforeChange(context);
		};
	}

	// Wire onUsed/onUnused subscriber tracking
	if (config?.onUsed || config?.onUnused) {
		let usedController: AbortController | null = null;
		let usedCleanups: (() => void)[] = [];

		if (config.onUsed) {
			const onUsedConfig = config.onUsed;
			store.onUsedHook = () => {
				usedController = new AbortController();
				usedCleanups = [];
				onUsedConfig({
					scope: instance as GenericScopeInstance,
					signal: usedController.signal,
					onCleanup: (fn) => usedCleanups.push(fn),
				});
			};
		}

		store.onUnusedHook = () => {
			// Run onUsed cleanups and abort signal
			for (const cleanup of usedCleanups) cleanup();
			usedCleanups = [];
			if (usedController) {
				usedController.abort();
				usedController = null;
			}
			// Fire onUnused callback
			if (config.onUnused) {
				config.onUnused({ scope: instance as GenericScopeInstance });
			}
		};

		// Clean up on destroy
		instanceCleanups.push(() => {
			for (const cleanup of usedCleanups) cleanup();
			usedCleanups = [];
			if (usedController) {
				usedController.abort();
				usedController = null;
			}
		});
	}

	// Propagate onUsed/onUnused transitively to every scope-instance ref —
	// shared or factory-created. Lifting an in-scope subscription on the
	// parent should "use" each referenced child, matching the README's
	// transitive-lifecycle contract.
	if (transitiveLifecycleRefs.length > 0) {
		const originalOnUsed = store.onUsedHook;
		const originalOnUnused = store.onUnusedHook;
		const childUntrackFns: (() => void)[] = [];

		store.onUsedHook = () => {
			originalOnUsed?.();
			for (const refInstance of transitiveLifecycleRefs) {
				const unsub = (
					refInstance.$subscribe as (fn: () => void) => () => void
				)(() => {});
				childUntrackFns.push(unsub);
			}
		};

		store.onUnusedHook = () => {
			// Unsubscribe from children first (triggers their onUnused)
			for (const unsub of childUntrackFns) unsub();
			childUntrackFns.length = 0;
			originalOnUnused?.();
		};
	}

	fireOnCreate(config, instance, input ?? undefined, lifecycleCleanups);

	return instance;
}

/** Walk a nested input object and resolve to flat slot index -> value pairs. @internal */
function resolveInputValues(
	definition: ScopeDefinitionMeta,
	input: Record<string, unknown>,
	pathPrefix: string,
	result: Map<number, unknown>,
): void {
	for (const key of Object.keys(input)) {
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;
		const value = input[key];

		// O(1) lookup via precomputed map
		const slotIndex = definition.pathToSlot.get(path);
		if (slotIndex !== undefined) {
			result.set(slotIndex, value);
			continue;
		}

		// O(1) group lookup
		const groupIndex = definition.pathToGroup.get(path);
		if (
			groupIndex !== undefined &&
			typeof value === 'object' &&
			value !== null
		) {
			resolveInputValues(
				definition,
				value as Record<string, unknown>,
				path,
				result,
			);
		}
	}
}

/** Collect input properties that don't match any declared slot or group. @internal */
function collectUndeclaredProperties(
	definition: ScopeDefinitionMeta,
	input: Record<string, unknown>,
	pathPrefix: string,
	result: Map<string, unknown>,
): void {
	for (const key of Object.keys(input)) {
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;
		const value = input[key];

		const slotIndex = definition.pathToSlot.get(path);
		if (slotIndex !== undefined) continue;

		const groupIndex = definition.pathToGroup.get(path);
		if (
			groupIndex !== undefined &&
			typeof value === 'object' &&
			value !== null
		) {
			collectUndeclaredProperties(
				definition,
				value as Record<string, unknown>,
				path,
				result,
			);
			continue;
		}

		if (groupIndex !== undefined) continue;

		// This key doesn't match any slot or group; it's undeclared
		result.set(path, value);
	}
}

/** Build the derivation scope tree: same shape as instance tree, but with {@link DerivationWrap} objects at reactive leaves. @internal */
function buildDerivationScopeTree(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	return buildDerivationGroupNode(definition, store, rootGroup);
}

function buildDerivationGroupNode(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	group: GroupMeta,
): Record<string, unknown> {
	const node: Record<string, unknown> = {};

	// Add child slots as DerivationWrap
	for (const slotIndex of group.childSlots) {
		const meta = definition.slots[slotIndex]!;
		const fieldName = meta.fieldName;
		node[fieldName] = new DerivationWrap(store, slotIndex);
	}

	// Add child groups recursively
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		node[fieldName] = Object.freeze(
			buildDerivationGroupNode(definition, store, childGroup),
		);
	}

	return node;
}

/** Build the instance tree: FieldValue/FieldDerived at reactive leaves, frozen plain objects for groups. @internal */
function buildInstanceTree(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	nodesBySlot: Map<number, ScopeNode>,
	nodesByGroup: Map<number, ScopeNode>,
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	const instance = buildGroupNode(
		definition,
		store,
		rootGroup,
		nodesBySlot,
		nodesByGroup,
	);
	nodesByGroup.set(0, instance);
	return instance;
}

function buildGroupNode(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	group: GroupMeta,
	nodesBySlot: Map<number, ScopeNode>,
	nodesByGroup: Map<number, ScopeNode>,
): Record<string, unknown> {
	const node: Record<string, unknown> = {};

	// Add child slots as FieldValue or FieldDerived
	for (const slotIndex of group.childSlots) {
		const meta = definition.slots[slotIndex]!;
		const fieldName = meta.fieldName;

		let wrapper: ScopeNode;
		switch (meta.kind) {
			case 'value':
				wrapper = new FieldValue(store, slotIndex);
				break;
			case 'schema':
				wrapper = new FieldValueSchema(store, slotIndex);
				break;
			case 'plain':
				wrapper = new FieldValuePlain(store, slotIndex);
				break;
			case 'derived':
				wrapper = new FieldDerived(store, slotIndex);
				break;
			case 'asyncDerived':
				wrapper = new FieldAsyncDerived(store, slotIndex);
				break;
		}

		node[fieldName] = wrapper;
		nodesBySlot.set(slotIndex, wrapper);
	}

	// Add child groups recursively.
	// Freezing is deferred to freezeChildGroups() so attachStaticEntries
	// can write nested paths into these objects first.
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		const childNode = buildGroupNode(
			definition,
			store,
			childGroup,
			nodesBySlot,
			nodesByGroup,
		);
		node[fieldName] = childNode;
		nodesByGroup.set(childGroupIndex, childNode);
	}

	return node;
}

/**
 * Freeze all non-root group nodes. Called after static entries have been
 * attached, so nested paths are writable during `attachStaticEntries`.
 * @internal
 */
function freezeChildGroups(
	definition: ScopeDefinitionMeta,
	nodesByGroup: Map<number, ScopeNode>,
): void {
	for (
		let groupIndex = 1;
		groupIndex < definition.groups.length;
		groupIndex++
	) {
		const node = nodesByGroup.get(groupIndex);
		if (node) Object.freeze(node);
	}
}

/**
 * Wrap a resolved ref source so `.use()` inside a derivation performs the
 * right kind of tracked read for that source shape. Returns `undefined` for
 * non-reactive values (plain data, functions, etc.), in which case the raw
 * source is attached to the derivation scope as-is.
 * @internal
 */
function wrapRefForDerivation(
	resolved: unknown,
): { use: () => unknown; get: () => unknown } | undefined {
	if (typeof resolved !== 'object' || resolved === null) return undefined;

	// Scope instance: `.use()` hands back the instance itself so derivations
	// can reach into its fields and `$` methods — `scope.child.use().field.get()`,
	// `scope.form.use().$getIsValid()`. `_trackAll()` registers a dep on every
	// slot up front, so the derivation re-runs on any field change inside the
	// referenced instance. Granularity is coarse by design; it's the price of
	// letting consumers read the full instance shape.
	if ('$get' in resolved && typeof resolved.$get === 'function') {
		const instance = resolved as Record<string, unknown> & {
			_trackAll?: () => void;
		};
		return {
			use: () => {
				instance._trackAll?.();
				return instance;
			},
			get: () => instance,
		};
	}

	// ScopeMap: `.use()` tracks the key-list version signal and hands back
	// the map. Consumers then call `.size`, `.keys()`, `.get(key)`, etc.
	if (resolved instanceof ScopeMap) {
		const map = resolved;
		return {
			use: () => {
				map._trackKeys();
				return map;
			},
			get: () => map,
		};
	}

	// Any reactive source with a parameterless `.get()` — Value, ValueSet,
	// ValueMap (whole-map read), ValuePlain, etc. Preact signals inside
	// `.get()` handle tracking; `.use()` is an alias here.
	if ('get' in resolved && typeof resolved.get === 'function') {
		const source = resolved as { get(): unknown };
		return {
			use: () => source.get(),
			get: () => source.get(),
		};
	}

	return undefined;
}

/** Set up sync derivations using Preact computed(). @internal */
function setupSyncDerivations(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	derivationScope: Record<string, unknown>,
	cleanups: (() => void)[],
): void {
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const meta = definition.slots[slot]!;

		if (meta.kind === 'derived' && meta.derivationFn) {
			const derivationFn = meta.derivationFn;
			// Version signal: bump to force recomputation even when deps haven't changed
			const version = createSignal(0);
			const slotIndex = slot;
			const derivedSignal: ReadonlySignal<unknown> = computed(() => {
				void version.value; // track version for forced recompute
				try {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return
					return derivationFn({ scope: derivationScope });
				} catch (error) {
					// A throwing derivation would otherwise propagate out of
					// the source `.set()` that triggered the recompute, since
					// the computed re-runs inside Preact's endBatch. Contain
					// the throw, log it, and keep the slot's last good value
					// so the source write succeeds and the next non-throwing
					// run recovers.
					console.error('valuse: sync derivation threw', error);
					return store.signals[slotIndex]!.peek();
				}
			});

			// Register a recompute function that bumps the version
			store._recomputeFns.set(slot, () => {
				version.value++;
			});

			// Set up an effect to sync the computed signal to the store's signal.
			// Dispose on $destroy so the computed graph is released.
			const dispose = effect(() => {
				const value = derivedSignal.value;
				store.signals[slot]!.value = value;
			});
			cleanups.push(dispose);
		}
	}
}

/** Per-run state for an async derivation's eager subscription model. @internal */
interface AsyncRun {
	controller: AbortController;
	/**
	 * Per-run de-duplication of eager subscriptions. Numeric keys identify
	 * slot subscriptions; string keys (`ref:<path>`) identify ref-source
	 * subscriptions, since refs don't have slot indices.
	 */
	subscriptions: Map<number | string, () => void>;
	cleanups: (() => void)[];
}

/** Mutable ref to the current async run. Shared by the scope tree so it doesn't need rebuilding on every re-run. @internal */
interface AsyncRunRef {
	current: AsyncRun;
	scheduleRerun: () => void;
}

/** Set up async derivations using eager subscriptions. Each use() call subscribes to the signal; when any tracked dep changes, the derivation aborts and re-runs. @internal */
function setupAsyncDerivations(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	initialValues: Map<number, unknown>,
	resolvedRefs: Map<string, unknown>,
	cleanups: (() => void)[],
): void {
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const meta = definition.slots[slot]!;

		if (meta.kind === 'asyncDerived' && meta.derivationFn) {
			const derivationFn = meta.derivationFn;
			const hasSeed = initialValues.has(slot);

			let lastValue: unknown = hasSeed ? initialValues.get(slot) : undefined;
			let isFirstRun = true;

			// Mutable ref so the scope tree (built once) always sees the current run
			const runRef: AsyncRunRef = {
				current: null!,
				scheduleRerun: null!,
			};

			const runDerivation = () => {
				// Abort previous run
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (runRef.current) {
					runRef.current.controller.abort();
					for (const cleanup of runRef.current.cleanups) cleanup();
					for (const [, unsub] of runRef.current.subscriptions) unsub();
				}

				const controller = new AbortController();
				runRef.current = {
					controller,
					subscriptions: new Map(),
					cleanups: [],
				};

				// Mark as running for cycle detection
				store.runningAsync.add(slot);

				// Transition to 'setting' state (skip on first run with seed)
				const asyncSignal = store.asyncStates.get(slot);
				if (asyncSignal && !(isFirstRun && hasSeed)) {
					const prev = asyncSignal.peek();
					asyncSignal.value = settingAsyncState(prev);
				}
				isFirstRun = false;

				const run = runRef.current;
				const context = {
					scope: asyncScope,
					signal: controller.signal,
					set: (value: unknown) => {
						if (controller.signal.aborted) return;
						lastValue = value;
						store.signals[slot]!.value = value;
						if (asyncSignal) {
							asyncSignal.value = resolvedAsyncState(value);
						}
					},
					onCleanup: (fn: () => void) => {
						run.cleanups.push(fn);
					},
					previousValue: lastValue,
				};

				// Run the async function
				try {
					const promise = derivationFn(context) as Promise<unknown>;
					promise
						.then((result: unknown) => {
							store.runningAsync.delete(slot);
							if (controller.signal.aborted) return;
							if (result !== undefined) {
								if (result === lastValue) {
									if (asyncSignal && asyncSignal.peek().status !== 'set') {
										asyncSignal.value = resolvedAsyncState(lastValue);
									}
									return;
								}
								lastValue = result;
								store.signals[slot]!.value = result;
								if (asyncSignal) {
									asyncSignal.value = resolvedAsyncState(result);
								}
							} else if (asyncSignal && !asyncSignal.peek().hasValue) {
								asyncSignal.value = initialAsyncState();
							} else if (asyncSignal) {
								asyncSignal.value = resolvedAsyncState(lastValue);
							}
						})
						.catch((error: unknown) => {
							store.runningAsync.delete(slot);
							if (controller.signal.aborted) return;
							if (asyncSignal) {
								asyncSignal.value = errorAsyncState(asyncSignal.peek(), error);
							}
						});
				} catch (error) {
					store.runningAsync.delete(slot);
					if (asyncSignal) {
						asyncSignal.value = errorAsyncState(asyncSignal.peek(), error);
					}
				}
			};

			// Build scope tree once, reused across all runs via runRef
			runRef.scheduleRerun = runDerivation;
			const asyncScope = buildAsyncDerivationScope(
				definition,
				store,
				slot,
				runRef,
				resolvedRefs,
			);

			// Register recompute function
			store._recomputeFns.set(slot, runDerivation);

			// Register a cleanup that aborts the in-flight run and tears down
			// eager subscriptions. Runs on $destroy per the docs contract.
			cleanups.push(() => {
				const run = runRef.current;
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (!run) return;
				run.controller.abort();
				for (const cleanup of run.cleanups) cleanup();
				for (const [, unsub] of run.subscriptions) unsub();
				run.cleanups.length = 0;
				run.subscriptions.clear();
				store.runningAsync.delete(slot);
			});

			// Run initial derivation
			runDerivation();
		}
	}
}

/** Build a derivation scope for async context that eagerly subscribes on each use() call. Built once per derivation; uses a mutable runRef so it doesn't need rebuilding on re-runs. @internal */
function buildAsyncDerivationScope(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	derivationSlot: number,
	runRef: AsyncRunRef,
	resolvedRefs: Map<string, unknown>,
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	const tree = buildAsyncGroupNode(
		definition,
		store,
		derivationSlot,
		runRef,
		rootGroup,
	);
	// Mirror the sync path (which attaches refs after the slot/group walk):
	// async derivations must also see `scope.<ref>.use()` / `.get()`, and
	// `.use()` must register an eager subscription on the ref's source so
	// dep changes trigger a re-run.
	for (const [path, resolved] of resolvedRefs) {
		const wrapped = wrapRefForAsyncDerivation(resolved, runRef, path);
		setNestedValue(tree, path, wrapped ?? resolved);
	}
	return tree;
}

/**
 * Async counterpart to {@link wrapRefForDerivation}. The sync wrapper relies
 * on Preact's automatic dep tracking inside `computed()`; async derivations
 * use an eager-subscription model instead, so each ref shape registers a
 * subscription on its source via the source's own `subscribe`/`$subscribe`.
 * Per-run dedup is keyed by `ref:<path>` so the same ref `.use()`'d multiple
 * times in one run only subscribes once.
 * @internal
 */
function wrapRefForAsyncDerivation(
	resolved: unknown,
	runRef: AsyncRunRef,
	path: string,
): { use: () => unknown; get: () => unknown } | undefined {
	if (typeof resolved !== 'object' || resolved === null) return undefined;

	const subKey = `ref:${path}`;

	const buildWrapper = (
		subscribe: (cb: () => void) => () => void,
		getValue: () => unknown,
	) => ({
		use: () => {
			const run = runRef.current;
			if (!run.subscriptions.has(subKey)) {
				const unsub = subscribe(() => {
					if (!run.controller.signal.aborted) {
						runRef.scheduleRerun();
					}
				});
				run.subscriptions.set(subKey, unsub);
			}
			return getValue();
		},
		get: getValue,
	});

	// Scope instance: `.use()` returns the instance, tracked via $subscribe
	// (whole-scope: fires on any field change), matching the coarse-grained
	// sync behavior backed by `_trackAll`.
	if ('$subscribe' in resolved && typeof resolved.$subscribe === 'function') {
		const instance = resolved as {
			$subscribe: (cb: () => void) => () => void;
		};
		return buildWrapper(
			(cb) => instance.$subscribe(cb),
			() => instance,
		);
	}

	// ScopeMap: subscribe fires on key-list changes only, matching `_trackKeys`.
	if (resolved instanceof ScopeMap) {
		const map = resolved;
		return buildWrapper(
			(cb) =>
				map.subscribe(() => {
					cb();
				}),
			() => map,
		);
	}

	// Value / ValueSet / ValueMap / ValueArray — anything with .subscribe + .get.
	if (
		'subscribe' in resolved &&
		typeof resolved.subscribe === 'function' &&
		'get' in resolved &&
		typeof (resolved as { get: unknown }).get === 'function'
	) {
		const source = resolved as {
			subscribe: (cb: () => void) => () => void;
			get: () => unknown;
		};
		return buildWrapper(
			(cb) =>
				source.subscribe(() => {
					cb();
				}),
			() => source.get(),
		);
	}

	return undefined;
}

function buildAsyncGroupNode(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	derivationSlot: number,
	runRef: AsyncRunRef,
	group: GroupMeta,
): Record<string, unknown> {
	const node: Record<string, unknown> = {};

	for (const slotIndex of group.childSlots) {
		const meta = definition.slots[slotIndex]!;
		const fieldName = meta.fieldName;

		node[fieldName] = {
			use: () => {
				// Cycle detection
				if (store.runningAsync.has(slotIndex)) {
					throw new Error(
						`Cycle detected: async derivation at "${meta.path}" tried to use() itself or a currently-running async derivation`,
					);
				}

				const run = runRef.current;
				// Eager subscribe if not already subscribed for this run
				if (!run.subscriptions.has(slotIndex)) {
					const unsub = store.subscribe(slotIndex, () => {
						if (!run.controller.signal.aborted) {
							runRef.scheduleRerun();
						}
					});
					run.subscriptions.set(slotIndex, unsub);
				}

				return store.read(slotIndex);
			},
			get: () => store.read(slotIndex),
			getAsync: () => store.readAsync(slotIndex),
		};
	}

	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		node[fieldName] = buildAsyncGroupNode(
			definition,
			store,
			derivationSlot,
			runRef,
			childGroup,
		);
	}

	return node;
}

/** Set up validation: the `validate` config derivation and `$getIsValid`/`$useIsValid`. @internal */
function setupValidation(
	instance: Record<string, unknown>,
	store: InstanceStore,
	definition: ScopeDefinitionMeta,
	config: ScopeConfig | undefined,
	derivationScope: Record<string, unknown>,
	cleanups: (() => void)[],
	resolvedRefs: Map<string, unknown>,
): void {
	// Collect schema slot indices
	const schemaSlots: number[] = [];
	for (let slot = 0; slot < definition.slotCount; slot++) {
		if (definition.slots[slot]!.kind === 'schema') {
			schemaSlots.push(slot);
		}
	}

	const validateFn = config?.validate;
	const hasValidateHook = !!validateFn;
	const hasValidationSources = schemaSlots.length > 0 || hasValidateHook;

	// Set up the validate derivation as a computed signal
	let validateIssuesSignal: ReturnType<typeof createSignal> | null = null;
	if (validateFn) {
		validateIssuesSignal = createSignal<
			{
				readonly message: string;
				readonly path?:
					| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
					| undefined;
			}[]
		>([]);

		// Run the validate function as a computed derivation
		const derivedValidateSignal = computed(() => {
			try {
				return validateFn({ scope: derivationScope });
			} catch (error) {
				// A throwing validate hook would otherwise propagate out of
				// the source `.set()` that triggered the recompute, and
				// leave `$getIsValid()` reporting `true` indefinitely (since
				// the issues signal never updated). Contain the throw, log
				// it, and synthesise a scope-level issue so the scope
				// reports invalid until the hook recovers.
				console.error('valuse: validate hook threw', error);
				return [
					{
						message:
							error instanceof Error ?
								`validate threw: ${error.message}`
							:	`validate threw: ${String(error)}`,
					},
				];
			}
		});

		// Sync computed to the signal. Disposed on $destroy.
		const dispose = effect(() => {
			validateIssuesSignal!.value = derivedValidateSignal.value;
		});
		cleanups.push(dispose);
	}

	// Helper to get routed validate issues for a specific field
	function getRoutedIssuesForField(fieldName: string) {
		if (!validateIssuesSignal) return [];
		const allIssues = (
			validateIssuesSignal as {
				peek(): {
					readonly message: string;
					readonly path?:
						| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
						| undefined;
				}[];
			}
		).peek();
		return allIssues.filter((issue) => {
			if (!issue.path || issue.path.length === 0) return false;
			const firstSegment = issue.path[0];
			const key =
				typeof firstSegment === 'object' && 'key' in firstSegment ?
					firstSegment.key
				:	firstSegment;
			return key === fieldName;
		});
	}

	// Patch schema field wrappers to include routed validate issues in getValidation
	if (hasValidateHook) {
		for (const slot of schemaSlots) {
			const meta = definition.slots[slot]!;
			const wrapper = instance[meta.fieldName] as FieldValueSchema<
				unknown,
				unknown
			>;

			const originalGetValidation = wrapper.getValidation.bind(wrapper);
			const slotIndex = slot;
			wrapper.getValidation = () => {
				const baseValidation = originalGetValidation();
				const routedIssues = getRoutedIssuesForField(meta.fieldName);
				if (routedIssues.length === 0) return baseValidation;

				// Merge issues. The `ValidationState<In, Out>` union flips on
				// `isValid`: `value` is `Out` (parsed) when valid, `In` (raw
				// input) when invalid. If routed issues flip a previously
				// valid result to invalid, swap the parsed `Out` back to the
				// raw `In` so the discriminated union holds. This only
				// matters for schemas that morph types (e.g. arktype
				// `string.numeric.parse`); for pure validators where In==Out
				// it's a no-op.
				const allIssues = [...baseValidation.issues, ...routedIssues];
				const value =
					baseValidation.isValid ? store.read(slotIndex) : baseValidation.value;
				return {
					isValid: false,
					value,
					issues: allIssues,
				};
			};

			// `useValidation` on the field wrapper used to only subscribe to
			// the field's own value signal and its own schema-validation
			// state. When a cross-field `validate` hook routed an issue here
			// via `path: ['<fieldName>']`, neither of those signals fired —
			// only `validateIssuesSignal` did — so the React hook never
			// re-rendered even though `getValidation()` would return updated
			// merged issues if you read it manually. Patch the hook so it
			// also subscribes to `validateIssuesSignal`.
			const slotForHook = slot;
			const originalUseValidation = wrapper.useValidation.bind(wrapper);
			wrapper.useValidation = () => {
				const hooks = getReactHooks();
				if (hooks && validateIssuesSignal) {
					const adapter = versionedAdapter(wrapper, (onChange) => {
						const unsub1 = wrapper.subscribe(() => {
							onChange();
						});
						const unsub2 = store.subscribeValidation(slotForHook, () => {
							onChange();
						});
						const unsub3 = subscribeFireOnly(() => {
							void (validateIssuesSignal as { value: unknown }).value;
						}, onChange);
						return () => {
							unsub1();
							unsub2();
							unsub3();
						};
					});
					hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
					return [
						wrapper.get(),
						(valueOrFn: unknown) => {
							wrapper.set(valueOrFn);
						},
						wrapper.getValidation(),
					] as ReturnType<typeof originalUseValidation>;
				}
				return originalUseValidation();
			};
		}
	}

	// Shared helpers used by shallow + deep checks
	function checkOwnValid(): boolean {
		for (const slot of schemaSlots) {
			const validation = store.readValidation(slot);
			if (!validation.isValid) return false;
		}
		if (validateIssuesSignal) {
			const issues = (
				validateIssuesSignal as {
					peek(): { readonly message: string }[];
				}
			).peek();
			if (issues.length > 0) return false;
		}
		return true;
	}

	// Deep walk: call each subscope's internal _deepCheckValid if present.
	function deepCheckValid(visited: WeakSet<object>): boolean {
		if (visited.has(instance)) return true;
		visited.add(instance);
		if (hasValidationSources && !checkOwnValid()) return false;
		for (const ref of resolvedRefs.values()) {
			if (!walkRefValid(ref, visited)) return false;
		}
		return true;
	}

	// Deep reactive track: touches every .value in the tree so an enclosing
	// effect re-runs when any relevant signal changes (including ScopeMap
	// membership and subscope validation).
	function trackDeepValid(visited: WeakSet<object>): void {
		if (visited.has(instance)) return;
		visited.add(instance);
		for (const slot of schemaSlots) {
			const sig = store.validationStates.get(slot);
			if (sig) void sig.value;
		}
		if (validateIssuesSignal) {
			void (validateIssuesSignal as { value: unknown }).value;
		}
		for (const ref of resolvedRefs.values()) {
			walkRefTrack(ref, visited);
		}
	}

	// Issue collectors mirror the boolean checks above but build a flat
	// `StandardSchemaV1.Issue[]` with scope-relative paths. Field issues are
	// prefixed with the field name; validate-hook issues pass through with
	// the author-supplied path.
	function collectOwnIssues(): StandardSchemaV1.Issue[] {
		const issues: StandardSchemaV1.Issue[] = [];
		for (const slot of schemaSlots) {
			const meta = definition.slots[slot]!;
			const validation = store.readValidation(slot);
			if (!validation.isValid) {
				for (const issue of validation.issues) {
					issues.push({
						message: issue.message,
						path: [meta.fieldName, ...(issue.path ?? [])],
					});
				}
			}
		}
		if (validateIssuesSignal) {
			const hookIssues = (
				validateIssuesSignal as {
					peek(): StandardSchemaV1.Issue[];
				}
			).peek();
			for (const issue of hookIssues) issues.push(issue);
		}
		return issues;
	}

	function deepCollectIssues(
		visited: WeakSet<object>,
	): StandardSchemaV1.Issue[] {
		if (visited.has(instance)) return [];
		visited.add(instance);
		const issues = hasValidationSources ? collectOwnIssues() : [];
		for (const [refKey, ref] of resolvedRefs) {
			const refIssues = walkRefCollect(ref, visited);
			for (const issue of refIssues) {
				issues.push({
					message: issue.message,
					path: [refKey, ...(issue.path ?? [])],
				});
			}
		}
		return issues;
	}

	// Subscription factory shared by `$useIsValid` and `$useValidation`. Both
	// hooks need to re-render on the same signal set (own schema slots +
	// validate-hook issues, or a deep walk via `_trackDeepValid`); only their
	// final return value differs.
	function subscribeValidationChanges(
		deep: boolean | undefined,
	): (onChange: () => void) => () => void {
		return (onChange) => {
			if (deep) {
				return subscribeFireOnly(() => {
					trackDeepValid(new WeakSet());
				}, onChange);
			}
			const unsubs: (() => void)[] = [];
			for (const slot of schemaSlots) {
				unsubs.push(store.subscribeValidation(slot, onChange));
			}
			if (validateIssuesSignal) {
				unsubs.push(
					subscribeFireOnly(() => {
						void (validateIssuesSignal as { value: unknown }).value;
					}, onChange),
				);
			}
			return () => {
				for (const unsub of unsubs) unsub();
			};
		};
	}

	// Expose the internal walkers so parent scopes can recurse into this one.
	instance._deepCheckValid = deepCheckValid;
	instance._trackDeepValid = trackDeepValid;
	instance._deepCollectIssues = deepCollectIssues;

	instance.$getIsValid = (options?: { deep?: boolean }) => {
		if (options?.deep) {
			return deepCheckValid(new WeakSet());
		}
		if (!hasValidationSources) {
			throw new Error(
				'$getIsValid() requires at least one valueSchema field or an validate hook.',
			);
		}
		return checkOwnValid();
	};

	instance.$useIsValid = (options?: { deep?: boolean }) => {
		if (!options?.deep && !hasValidationSources) {
			throw new Error(
				'$useIsValid() requires at least one valueSchema field or an validate hook.',
			);
		}
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(
				instance,
				subscribeValidationChanges(options?.deep),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return (instance.$getIsValid as (options?: { deep?: boolean }) => boolean)(
			options,
		);
	};

	instance.$getValidation = (options?: { deep?: boolean }) => {
		if (options?.deep) {
			const issues = deepCollectIssues(new WeakSet());
			return { isValid: issues.length === 0, issues };
		}
		if (!hasValidationSources) {
			throw new Error(
				'$getValidation() requires at least one valueSchema field or an validate hook.',
			);
		}
		const issues = collectOwnIssues();
		return { isValid: issues.length === 0, issues };
	};

	instance.$useValidation = (options?: { deep?: boolean }) => {
		if (!options?.deep && !hasValidationSources) {
			throw new Error(
				'$useValidation() requires at least one valueSchema field or an validate hook.',
			);
		}
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(
				instance,
				subscribeValidationChanges(options?.deep),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return (
			instance.$getValidation as (options?: {
				deep?: boolean;
			}) => ScopeValidationResult
		)(options);
	};
}

/** Attach static entries to the instance tree. @internal */
function attachStaticEntries(
	definition: ScopeDefinitionMeta,
	instance: Record<string, unknown>,
): void {
	for (const [path, value] of definition.staticEntries) {
		setNestedValue(instance, path, value);
	}
}

/** Set a value at a dot-separated path on a nested object. @internal */
function setNestedValue(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split('.');
	let current = target;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]!;
		if (!(part in current) || typeof current[part] !== 'object') {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts.at(-1)!] = value;
}

/** Attach $-prefixed instance methods. @internal */
function attachDollarMethods(
	instance: Record<string, unknown>,
	store: InstanceStore,
	definition: ScopeDefinitionMeta,
	config: ScopeConfig | undefined,
	instanceCleanups: (() => void)[],
	lifecycleCleanups: (() => void)[],
	undeclaredProperties?: Map<string, unknown>,
	factoryRefInstances?: Record<string, unknown>[],
	factoryRefDestroyables?: { destroy: () => void }[],
): void {
	// Register a Preact dependency on every slot signal. Used by the snapshot
	// invalidator, `$subscribe`, and `instance._trackAll` (the derivation-scope
	// ref hook). Coarse-grained by design.
	const trackAllSlots = (): void => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			void store.signals[slot]!.value;
		}
	};

	instance.$destroy = () => {
		// Idempotency: a second call must be a no-op so onDestroy fires once
		// and factory-ref children aren't re-destroyed. Naturally exercised
		// when ScopeMap.delete (which calls $destroy internally) and a
		// caller-held reference both reach for $destroy.
		if (store.destroyed) return;

		// Run lifecycle disposers first (aborts the onCreate signal so user
		// cleanups see a consistent torn-down state), then instance-level
		// disposers (derivation effects, validation, snapshot tracking).
		for (const cleanup of lifecycleCleanups) cleanup();
		lifecycleCleanups.length = 0;
		for (const cleanup of instanceCleanups) cleanup();
		instanceCleanups.length = 0;

		// Propagate $destroy to factory-created scope refs.
		if (factoryRefInstances) {
			for (const refInstance of factoryRefInstances) {
				if (typeof refInstance.$destroy === 'function') {
					(refInstance.$destroy as () => void)();
				}
			}
		}

		// Tear down factory-created reactive primitives (Value / ValueSet /
		// ValueMap / ValueArray) — they expose `.destroy()` rather than
		// `$destroy`. Without this they leaked subscribers on parent destroy.
		if (factoryRefDestroyables) {
			for (const ref of factoryRefDestroyables) {
				ref.destroy();
			}
		}

		// Fire onDestroy
		if (config?.onDestroy) {
			config.onDestroy({ scope: instance as GenericScopeInstance });
		}

		store.destroy();
	};

	// Memoized snapshot: rebuilt lazily, invalidated whenever any tracked
	// signal changes. `$use` returns this same reference across renders when
	// nothing has changed, so React downstream can rely on Object.is equality.
	// We also track `store._plainVersion` so plain writes invalidate the
	// cache (keeping `$getSnapshot()` fresh) without dirtying the per-slot
	// signal graph that `$subscribe`/derivations observe.
	let cachedSnapshot: Record<string, unknown> | null = null;
	let snapshotDirty = true;
	const invalidateSnapshot = effect(() => {
		trackAllSlots();
		void store._plainVersion.value;
		snapshotDirty = true;
	});
	instanceCleanups.push(invalidateSnapshot);

	function getMemoizedSnapshot(): Record<string, unknown> {
		if (snapshotDirty || cachedSnapshot === null) {
			cachedSnapshot = buildSnapshot(definition, store);
			snapshotDirty = false;
		}
		return cachedSnapshot;
	}

	instance.$getSnapshot = () => {
		const snapshot = getMemoizedSnapshot();
		if (undeclaredProperties && undeclaredProperties.size > 0) {
			const result = { ...snapshot };
			for (const [path, value] of undeclaredProperties) {
				setNestedValue(result, path, value);
			}
			return result;
		}
		return snapshot;
	};

	instance.$setSnapshot = (
		data: Record<string, unknown>,
		options?: { recreate?: boolean },
	) => {
		setSnapshotValues(definition, store, data, '');

		if (options?.recreate) {
			// Recreate models a fresh onDestroy → onCreate cycle. Only touch
			// lifecycle disposers; per-instance derivation infrastructure
			// (sync effects, async aborts, validation) stays alive so
			// downstream behavior keeps reacting.
			for (const cleanup of lifecycleCleanups) cleanup();
			lifecycleCleanups.length = 0;

			if (config?.onDestroy) {
				config.onDestroy({ scope: instance as GenericScopeInstance });
			}

			fireOnCreate(config, instance, data, lifecycleCleanups);
		}
	};

	instance.$subscribe = (fn: () => void): Unsubscribe => {
		const untrackExternal = store.trackExternalSubscription();
		const dispose = subscribeFireOnly(trackAllSlots, fn);

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			dispose();
			untrackExternal();
		};
	};

	instance.$use = () => {
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(instance, (onChange) => {
				return (instance.$subscribe as (fn: () => void) => () => void)(
					onChange,
				);
			});
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		const snapshot = getMemoizedSnapshot();
		const setter = (data: Record<string, unknown>) => {
			(instance.$setSnapshot as (data: Record<string, unknown>) => void)(data);
		};
		return [snapshot, setter];
	};

	instance.$recompute = () => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			store.recompute(slot);
		}
	};

	instance.$get = () => {
		return buildSnapshot(definition, store);
	};

	// Internal: register a Preact dependency on every slot. Used by the
	// derivation-scope ref wrapper so `scope.<instanceRef>.use()` re-runs
	// the enclosing derivation when any field on the referenced instance
	// changes. Tracks coarsely — all fields, regardless of which the
	// consumer reads from the returned snapshot.
	instance._trackAll = trackAllSlots;
}

/** Build a plain snapshot of all values. @internal */
function buildSnapshot(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	// Add reactive slot values
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const meta = definition.slots[slot]!;
		setNestedValue(result, meta.path, store.read(slot));
	}

	// Add static entries
	for (const [path, value] of definition.staticEntries) {
		setNestedValue(result, path, value);
	}

	return result;
}

/** Set values from a snapshot, only writing to value slots. @internal */
function setSnapshotValues(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	data: Record<string, unknown>,
	pathPrefix: string,
): void {
	for (const key of Object.keys(data)) {
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;
		const value = data[key];

		// O(1) lookup, only write to value slots
		const slotIndex = definition.pathToSlot.get(path);
		const slotKind =
			slotIndex !== undefined ? definition.slots[slotIndex]!.kind : undefined;
		if (
			slotIndex !== undefined &&
			(slotKind === 'value' || slotKind === 'schema')
		) {
			store.write(slotIndex, value);
			continue;
		}

		// O(1) group lookup
		const groupIndex = definition.pathToGroup.get(path);
		if (groupIndex !== undefined) {
			if (typeof value === 'object' && value !== null) {
				setSnapshotValues(
					definition,
					store,
					value as Record<string, unknown>,
					path,
				);
			} else {
				// Group path with non-object value would otherwise silently
				// drop on the floor — visible only by inspecting state.
				console.warn(
					`valuse: $setSnapshot received a non-object value for group path "${path}". ` +
						'Expected a plain object matching the group shape. Skipping.',
				);
			}
		}
	}
}
