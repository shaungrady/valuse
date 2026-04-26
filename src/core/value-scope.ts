/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
	signal as createSignal,
	computed,
	effect,
	type ReadonlySignal,
} from './signal.js';
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
import type { ValidationState } from './value-schema.js';
import {
	initialAsyncState,
	settingAsyncState,
	resolvedAsyncState,
	errorAsyncState,
} from './async-state.js';
import { ScopeMap } from './scope-map.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';
import type { ScopeDefinitionMeta, GroupMeta } from './slot-meta.js';
import type { Change, ScopeNode, Unsubscribe } from './types.js';
import type {
	ScopeInstance,
	ValueInputOf,
	ExtendDef,
	GenericScopeInstance,
	ScopeValidationResult,
} from './scope-types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

// --- Scope Config ---

/**
 * Lifecycle hooks and options for a scope.
 *
 * @remarks
 * Scope configuration allows you to intercept changes, respond to lifecycle events,
 * and enable advanced features like undeclared property passthrough.
 *
 * @typeParam Def - the scope definition record.
 */
export interface ScopeConfig {
	/**
	 * When `true`, preserve properties not declared in the scope definition
	 * as plain, non-reactive passthrough data.
	 *
	 * @defaultValue `false`
	 */
	allowUndeclaredProperties?: boolean;

	/**
	 * Fires once after the instance is created.
	 *
	 * @param context.scope - the scope instance tree.
	 * @param context.input - the raw input passed to `.create()`.
	 * @param context.signal - `AbortSignal` that aborts when the instance is destroyed.
	 * @param context.onCleanup - register a cleanup function that runs on destroy.
	 *
	 * @example
	 * ```ts
	 * onCreate: ({ scope, signal, onCleanup }) => {
	 *   document.addEventListener('resize', () => scope.width.set(innerWidth), { signal });
	 *   const timer = setInterval(() => scope.tick.set(Date.now()), 1000);
	 *   onCleanup(() => clearInterval(timer));
	 * }
	 * ```
	 */
	onCreate?: (context: {
		scope: GenericScopeInstance;
		input: Record<string, unknown> | undefined;
		signal: AbortSignal;
		onCleanup: (fn: () => void) => void;
	}) => void;

	/**
	 * Fires when `$destroy()` is called on the instance.
	 *
	 * @param context - object containing the scope instance.
	 */
	onDestroy?: (context: { scope: GenericScopeInstance }) => void;

	/**
	 * Fires on a microtask after one or more value fields change. Changes are batched.
	 *
	 * @param context - change metadata including the affected scope nodes.
	 *
	 * @example
	 * ```ts
	 * onChange: ({ changes }) => {
	 *   console.log(`${changes.size} fields changed`);
	 * }
	 * ```
	 */
	onChange?: (context: {
		scope: ScopeNode;
		changes: Set<Change>;
		changesByScope: Map<ScopeNode, Change[]>;
	}) => void;

	/**
	 * Fires synchronously before value fields are written.
	 * Can prevent individual or all changes.
	 *
	 * @param context - change metadata and a `prevent()` function.
	 *
	 * @example
	 * ```ts
	 * beforeChange: ({ changes, prevent }) => {
	 *   for (const change of changes) {
	 *     if (change.key === 'locked') prevent(change);
	 *   }
	 * }
	 * ```
	 */
	beforeChange?: (context: {
		scope: ScopeNode;
		changes: Set<Change>;
		changesByScope: Map<ScopeNode, Change[]>;
		prevent: (target?: ScopeNode | Change) => void;
	}) => void;

	/**
	 * Fires when the first subscriber attaches to any reactive field in the scope.
	 *
	 * @param context.scope - the scope instance tree.
	 * @param context.signal - `AbortSignal` that aborts when the last subscriber detaches.
	 * @param context.onCleanup - register a cleanup function that runs on detach.
	 */
	onUsed?: (context: {
		scope: GenericScopeInstance;
		signal: AbortSignal;
		onCleanup: (fn: () => void) => void;
	}) => void;

	/**
	 * Fires when the last subscriber detaches from all reactive fields in the scope.
	 *
	 * @param context - object containing the scope instance.
	 */
	onUnused?: (context: { scope: GenericScopeInstance }) => void;

	/**
	 * Cross-field validation. A reactive derivation that returns
	 * `StandardSchemaV1.Issue[]`. Re-evaluates when any `.use()`'d
	 * dependency changes. Issues with a `path` matching a field name
	 * are routed to that field's validation state.
	 */
	validate?: (context: { scope: Record<string, unknown> }) => {
		readonly message: string;
		readonly path?:
			| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
			| undefined;
	}[];
}

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
			input as Record<string, unknown> | undefined,
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
			for (const item of items) {
				const key =
					typeof keyFieldOrFn === 'function' ?
						keyFieldOrFn(item)
					:	(item[keyFieldOrFn as keyof typeof item] as K);
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

/** Merge two scope configs, running both hooks in order. @internal */
function mergeConfigs(
	base: ScopeConfig | undefined,
	extension: ScopeConfig | undefined,
): ScopeConfig | undefined {
	if (!base && !extension) return undefined;
	if (!base) return extension;
	if (!extension) return base;

	const merged: ScopeConfig = {};
	const allowUndeclared =
		extension.allowUndeclaredProperties ?? base.allowUndeclaredProperties;
	if (allowUndeclared !== undefined)
		merged.allowUndeclaredProperties = allowUndeclared;

	const onCreate = mergeHook(base.onCreate, extension.onCreate);
	if (onCreate) merged.onCreate = onCreate;
	const onDestroy = mergeHook(base.onDestroy, extension.onDestroy);
	if (onDestroy) merged.onDestroy = onDestroy;
	const onChange = mergeHook(base.onChange, extension.onChange);
	if (onChange) merged.onChange = onChange;
	const beforeChange = mergeHook(base.beforeChange, extension.beforeChange);
	if (beforeChange) merged.beforeChange = beforeChange;
	const onUsed = mergeHook(base.onUsed, extension.onUsed);
	if (onUsed) merged.onUsed = onUsed;
	const onUnused = mergeHook(base.onUnused, extension.onUnused);
	if (onUnused) merged.onUnused = onUnused;

	// validate hooks concatenate their issues
	if (base.validate || extension.validate) {
		const baseValidate = base.validate;
		const extValidate = extension.validate;
		merged.validate = (context) => {
			const baseIssues = baseValidate ? baseValidate(context) : [];
			const extIssues = extValidate ? extValidate(context) : [];
			return [...baseIssues, ...extIssues];
		};
	}

	return merged;
}

function mergeHook<Args extends readonly unknown[]>(
	base: ((...args: Args) => void) | undefined,
	extension: ((...args: Args) => void) | undefined,
): ((...args: Args) => void) | undefined {
	if (!base) return extension;
	if (!extension) return base;
	return (...args: Args) => {
		base(...args);
		extension(...args);
	};
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
				factoryRefInstances.push(resolved as Record<string, unknown>);
			}
		} else {
			resolved = ref.source;
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

	// Collect disposers to run on $destroy. Populated by the setup steps below.
	const createCleanups: (() => void)[] = [];

	// Set up sync derivations
	setupSyncDerivations(definition, store, derivationScope, createCleanups);

	// Set up async derivations
	setupAsyncDerivations(definition, store, initialValues, createCleanups);

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
		createCleanups,
		undeclaredProperties,
		factoryRefInstances,
	);

	// Set up validate config and $getIsValid/$useIsValid
	setupValidation(
		instance,
		store,
		definition,
		config,
		derivationScope,
		createCleanups,
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
		createCleanups.push(() => {
			for (const cleanup of usedCleanups) cleanup();
			usedCleanups = [];
			if (usedController) {
				usedController.abort();
				usedController = null;
			}
		});
	}

	// Propagate onUsed/onUnused transitively to factory-created ref instances.
	// This wires the parent's subscriber tracking to also count toward child scopes.
	if (factoryRefInstances.length > 0) {
		const originalOnUsed = store.onUsedHook;
		const originalOnUnused = store.onUnusedHook;
		const childUntrackFns: (() => void)[] = [];

		store.onUsedHook = () => {
			originalOnUsed?.();
			// Mark each factory ref child as "used" by tracking an external subscription
			for (const refInstance of factoryRefInstances) {
				if ('$subscribe' in refInstance) {
					// Use a dummy subscription to increment the child's subscriber count
					const unsub = (
						refInstance.$subscribe as (fn: () => void) => () => void
					)(() => {});
					childUntrackFns.push(unsub);
				}
			}
		};

		store.onUnusedHook = () => {
			// Unsubscribe from children first (triggers their onUnused)
			for (const unsub of childUntrackFns) unsub();
			childUntrackFns.length = 0;
			originalOnUnused?.();
		};
	}

	// Create lifecycle AbortController (aborts on $destroy)
	const lifecycleController = new AbortController();
	createCleanups.push(() => {
		lifecycleController.abort();
	});

	// Fire onCreate
	if (config?.onCreate) {
		config.onCreate({
			scope: instance as GenericScopeInstance,
			input: input ?? undefined,
			signal: lifecycleController.signal,
			onCleanup: (fn) => createCleanups.push(fn),
		});
	}

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
	if (
		'$get' in resolved &&
		typeof (resolved as { $get: unknown }).$get === 'function'
	) {
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
	if (
		'get' in resolved &&
		typeof (resolved as { get: unknown }).get === 'function'
	) {
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
			const derivedSignal: ReadonlySignal<unknown> = computed(() => {
				void version.value; // track version for forced recompute
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return derivationFn({ scope: derivationScope });
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
	subscriptions: Map<number, () => void>;
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
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	return buildAsyncGroupNode(
		definition,
		store,
		derivationSlot,
		runRef,
		rootGroup,
	);
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

	// Build a map from field name to schema slot index for issue routing
	const fieldNameToSlot = new Map<string, number>();
	for (const slot of schemaSlots) {
		const meta = definition.slots[slot]!;
		fieldNameToSlot.set(meta.fieldName, slot);
	}

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
			return validateFn({ scope: derivationScope });
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
			wrapper.getValidation = () => {
				const baseValidation = originalGetValidation();
				const routedIssues = getRoutedIssuesForField(meta.fieldName);
				if (routedIssues.length === 0) return baseValidation;

				// Merge issues: if base was valid but we have routed issues, it's now invalid
				const allIssues = [...baseValidation.issues, ...routedIssues];
				return {
					isValid: false,
					value: baseValidation.value,
					issues: allIssues,
				} as ValidationState<unknown, unknown>;
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
			const adapter = versionedAdapter(instance, (onChange) => {
				if (options?.deep) {
					let isFirst = true;
					const dispose = effect(() => {
						trackDeepValid(new WeakSet());
						if (isFirst) {
							isFirst = false;
							return;
						}
						onChange();
					});
					return dispose;
				}
				const unsubs: (() => void)[] = [];
				for (const slot of schemaSlots) {
					unsubs.push(store.subscribeValidation(slot, onChange));
				}
				if (validateIssuesSignal) {
					let isFirst = true;
					const dispose = effect(() => {
						void (validateIssuesSignal as { value: unknown }).value;
						if (isFirst) {
							isFirst = false;
							return;
						}
						onChange();
					});
					unsubs.push(dispose);
				}
				return () => {
					for (const unsub of unsubs) unsub();
				};
			});
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
			const adapter = versionedAdapter(instance, (onChange) => {
				if (options?.deep) {
					let isFirst = true;
					const dispose = effect(() => {
						trackDeepValid(new WeakSet());
						if (isFirst) {
							isFirst = false;
							return;
						}
						onChange();
					});
					return dispose;
				}
				const unsubs: (() => void)[] = [];
				for (const slot of schemaSlots) {
					unsubs.push(store.subscribeValidation(slot, onChange));
				}
				if (validateIssuesSignal) {
					let isFirst = true;
					const dispose = effect(() => {
						void (validateIssuesSignal as { value: unknown }).value;
						if (isFirst) {
							isFirst = false;
							return;
						}
						onChange();
					});
					unsubs.push(dispose);
				}
				return () => {
					for (const unsub of unsubs) unsub();
				};
			});
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return (
			instance.$getValidation as (options?: {
				deep?: boolean;
			}) => ScopeValidationResult
		)(options);
	};
}

/** Walk a ref value, collecting nested issues with prefixed paths. @internal */
function walkRefCollect(
	ref: unknown,
	visited: WeakSet<object>,
): StandardSchemaV1.Issue[] {
	if (ref instanceof ScopeMap) {
		const collected: StandardSchemaV1.Issue[] = [];
		for (const [entryKey, entry] of ref.entries()) {
			const entryIssues = walkRefCollect(entry, visited);
			for (const issue of entryIssues) {
				collected.push({
					message: issue.message,
					path: [entryKey, ...(issue.path ?? [])],
				});
			}
		}
		return collected;
	}
	if (isScopeLike(ref)) {
		const deepCollect = (ref as Record<string, unknown>)._deepCollectIssues as
			| ((visited: WeakSet<object>) => StandardSchemaV1.Issue[])
			| undefined;
		if (typeof deepCollect === 'function') return deepCollect(visited);
	}
	return [];
}

/** Walk a ref value for deep validation. Returns false if any nested scope fails. @internal */
function walkRefValid(ref: unknown, visited: WeakSet<object>): boolean {
	if (ref instanceof ScopeMap) {
		for (const entry of ref.values()) {
			if (!walkRefValid(entry, visited)) return false;
		}
		return true;
	}
	if (isScopeLike(ref)) {
		const deepCheck = (ref as Record<string, unknown>)._deepCheckValid as
			| ((visited: WeakSet<object>) => boolean)
			| undefined;
		if (typeof deepCheck === 'function') {
			return deepCheck(visited);
		}
	}
	return true;
}

/** Walk a ref value, touching reactive signals for deep validation tracking. @internal */
function walkRefTrack(ref: unknown, visited: WeakSet<object>): void {
	if (ref instanceof ScopeMap) {
		ref._trackKeys();
		for (const entry of ref.values()) {
			walkRefTrack(entry, visited);
		}
		return;
	}
	if (isScopeLike(ref)) {
		const trackDeep = (ref as Record<string, unknown>)._trackDeepValid as
			| ((visited: WeakSet<object>) => void)
			| undefined;
		if (typeof trackDeep === 'function') trackDeep(visited);
	}
}

function isScopeLike(x: unknown): boolean {
	return typeof x === 'object' && x !== null && '$destroy' in x;
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
	current[parts[parts.length - 1]!] = value;
}

/** Attach $-prefixed instance methods. @internal */
function attachDollarMethods(
	instance: Record<string, unknown>,
	store: InstanceStore,
	definition: ScopeDefinitionMeta,
	config: ScopeConfig | undefined,
	createCleanups: (() => void)[],
	undeclaredProperties?: Map<string, unknown>,
	factoryRefInstances?: Record<string, unknown>[],
): void {
	instance.$destroy = () => {
		// Run onCreate cleanups
		for (const cleanup of createCleanups) cleanup();
		createCleanups.length = 0;

		// Propagate $destroy to factory-created ref instances
		if (factoryRefInstances) {
			for (const refInstance of factoryRefInstances) {
				if (typeof refInstance.$destroy === 'function') {
					(refInstance.$destroy as () => void)();
				}
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
	let cachedSnapshot: Record<string, unknown> | null = null;
	let snapshotDirty = true;
	const invalidateSnapshot = effect(() => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			void store.signals[slot]!.value;
		}
		snapshotDirty = true;
	});
	createCleanups.push(invalidateSnapshot);

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
			// Run onDestroy then onCreate lifecycle
			for (const cleanup of createCleanups) cleanup();
			createCleanups.length = 0;

			if (config?.onDestroy) {
				config.onDestroy({ scope: instance as GenericScopeInstance });
			}

			// Fresh lifecycle controller for the recreated instance
			const recreateController = new AbortController();
			createCleanups.push(() => {
				recreateController.abort();
			});

			if (config?.onCreate) {
				config.onCreate({
					scope: instance as GenericScopeInstance,
					input: data,
					signal: recreateController.signal,
					onCleanup: (fn) => createCleanups.push(fn),
				});
			}
		}
	};

	instance.$subscribe = (fn: () => void): Unsubscribe => {
		const untrackExternal = store.trackExternalSubscription();

		// Single effect that tracks all signals, fires fn() on any change
		let isFirstRun = true;
		const dispose = effect(() => {
			for (let slot = 0; slot < definition.slotCount; slot++) {
				void store.signals[slot]!.value; // track all signals
			}
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			fn();
		});

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
	instance._trackAll = () => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			void store.signals[slot]!.value;
		}
	};
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
		if (
			groupIndex !== undefined &&
			typeof value === 'object' &&
			value !== null
		) {
			setSnapshotValues(
				definition,
				store,
				value as Record<string, unknown>,
				path,
			);
		}
	}
}
