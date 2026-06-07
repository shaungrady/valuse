/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
	signal as createSignal,
	computed,
	effect,
	batchSets,
	type ReadonlySignal,
} from './signal.js';
import { subscribeFireOnly } from './utils/effect-helpers.js';
import { createDeferral, type Deferral } from './utils/deferral.js';
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
	GenericScopeInstance,
	ScopeValidationResult,
	DerivationLayer,
	FieldLayer,
	DeepMerge,
} from './scope-types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Simplify } from 'type-fest';

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
	readonly #layers: ReadonlyArray<Record<string, unknown>>;
	readonly #config: ScopeConfig | undefined;

	/** @internal */
	constructor(
		rawDefinition: Record<string, unknown>,
		layers: ReadonlyArray<Record<string, unknown>>,
		config?: ScopeConfig,
	) {
		this.#rawDefinition = rawDefinition;
		this.#layers = layers;
		this.#definition = buildScopeDefinition(rawDefinition);
		this.#config = config;
	}

	/**
	 * The declared layer structure as an array of layer literals in
	 * dependency order: index 0 is the field layer, subsequent entries
	 * are derivation layers. Extensions append.
	 *
	 * Used by the flush pipeline to cascade `$flush()` through layers in
	 * dependency order. See `docs/derivations.md`.
	 *
	 * @internal
	 */
	get $layers(): ReadonlyArray<Record<string, unknown>> {
		return this.#layers;
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
			this.#layers,
		) as unknown as ScopeInstance<Def>;
	}

	// ── Variadic .extendValues() overloads ───────────────────────────────
	//
	// Mirrors valueScope's field+deriv slot structure, minus the trailing
	// config slot. Slot 1 may be a field layer or a derivation layer
	// (typed against the base `Def`). Slot 2+ are derivation layers typed
	// against the accumulated definition.
	//
	// Multi-arg form requires slot 1 to be a field layer; to extend with
	// only derivations from multi-arg form, pass `{}` in slot 1
	// (`template.extendValues({}, { deriv1 }, { deriv2 })`).

	/* eslint-disable @typescript-eslint/unified-signatures */

	// 1 arg — derivation layer (against base Def). Listed FIRST so
	// function-containing literals receive contextual typing for their
	// `({ scope }) => ...` parameters before the field-layer overload's
	// FieldEntry<fn> = never check rejects the call.
	extendValues<L1 extends Record<string, unknown>>(
		l1: L1 & DerivationLayer<Def, L1>,
	): ScopeTemplate<ExtAcc1<Def, L1>>;
	// 1 arg — field layer
	extendValues<L1 extends Record<string, unknown>>(
		l1: L1 & FieldLayer<L1>,
	): ScopeTemplate<ExtAcc1<Def, L1>>;

	// 2 args — fields + derivations
	extendValues<L1 extends Record<string, unknown>, L2>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
	): ScopeTemplate<ExtAcc2<Def, L1, L2>>;

	// 3 args
	extendValues<L1 extends Record<string, unknown>, L2, L3>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
	): ScopeTemplate<ExtAcc3<Def, L1, L2, L3>>;

	// 4 args
	extendValues<L1 extends Record<string, unknown>, L2, L3, L4>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
	): ScopeTemplate<ExtAcc4<Def, L1, L2, L3, L4>>;

	// 5 args
	extendValues<L1 extends Record<string, unknown>, L2, L3, L4, L5>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
	): ScopeTemplate<ExtAcc5<Def, L1, L2, L3, L4, L5>>;

	// 6 args
	extendValues<L1 extends Record<string, unknown>, L2, L3, L4, L5, L6>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
	): ScopeTemplate<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>>;

	// 7 args
	extendValues<L1 extends Record<string, unknown>, L2, L3, L4, L5, L6, L7>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
		l7: L7 & DerivationLayer<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>, L7>,
	): ScopeTemplate<ExtAcc7<Def, L1, L2, L3, L4, L5, L6, L7>>;

	// 8 args
	extendValues<L1 extends Record<string, unknown>, L2, L3, L4, L5, L6, L7, L8>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
		l7: L7 & DerivationLayer<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>, L7>,
		l8: L8 & DerivationLayer<ExtAcc7<Def, L1, L2, L3, L4, L5, L6, L7>, L8>,
	): ScopeTemplate<ExtAcc8<Def, L1, L2, L3, L4, L5, L6, L7, L8>>;

	// 9 args
	extendValues<
		L1 extends Record<string, unknown>,
		L2,
		L3,
		L4,
		L5,
		L6,
		L7,
		L8,
		L9,
	>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
		l7: L7 & DerivationLayer<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>, L7>,
		l8: L8 & DerivationLayer<ExtAcc7<Def, L1, L2, L3, L4, L5, L6, L7>, L8>,
		l9: L9 & DerivationLayer<ExtAcc8<Def, L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	): ScopeTemplate<ExtAcc9<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9>>;

	// 10 args
	extendValues<
		L1 extends Record<string, unknown>,
		L2,
		L3,
		L4,
		L5,
		L6,
		L7,
		L8,
		L9,
		L10,
	>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
		l7: L7 & DerivationLayer<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>, L7>,
		l8: L8 & DerivationLayer<ExtAcc7<Def, L1, L2, L3, L4, L5, L6, L7>, L8>,
		l9: L9 & DerivationLayer<ExtAcc8<Def, L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
		l10: L10 &
			DerivationLayer<ExtAcc9<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
	): ScopeTemplate<ExtAcc10<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>>;

	// 11 args
	extendValues<
		L1 extends Record<string, unknown>,
		L2,
		L3,
		L4,
		L5,
		L6,
		L7,
		L8,
		L9,
		L10,
		L11,
	>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
		l7: L7 & DerivationLayer<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>, L7>,
		l8: L8 & DerivationLayer<ExtAcc7<Def, L1, L2, L3, L4, L5, L6, L7>, L8>,
		l9: L9 & DerivationLayer<ExtAcc8<Def, L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
		l10: L10 &
			DerivationLayer<ExtAcc9<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
		l11: L11 &
			DerivationLayer<
				ExtAcc10<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>,
				L11
			>,
	): ScopeTemplate<ExtAcc11<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>>;

	// 12 args
	extendValues<
		L1 extends Record<string, unknown>,
		L2,
		L3,
		L4,
		L5,
		L6,
		L7,
		L8,
		L9,
		L10,
		L11,
		L12,
	>(
		l1: L1 & FieldLayer<L1>,
		l2: L2 & DerivationLayer<ExtAcc1<Def, L1>, L2>,
		l3: L3 & DerivationLayer<ExtAcc2<Def, L1, L2>, L3>,
		l4: L4 & DerivationLayer<ExtAcc3<Def, L1, L2, L3>, L4>,
		l5: L5 & DerivationLayer<ExtAcc4<Def, L1, L2, L3, L4>, L5>,
		l6: L6 & DerivationLayer<ExtAcc5<Def, L1, L2, L3, L4, L5>, L6>,
		l7: L7 & DerivationLayer<ExtAcc6<Def, L1, L2, L3, L4, L5, L6>, L7>,
		l8: L8 & DerivationLayer<ExtAcc7<Def, L1, L2, L3, L4, L5, L6, L7>, L8>,
		l9: L9 & DerivationLayer<ExtAcc8<Def, L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
		l10: L10 &
			DerivationLayer<ExtAcc9<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
		l11: L11 &
			DerivationLayer<
				ExtAcc10<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>,
				L11
			>,
		l12: L12 &
			DerivationLayer<
				ExtAcc11<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>,
				L12
			>,
	): ScopeTemplate<
		ExtAcc12<Def, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12>
	>;

	/* eslint-enable @typescript-eslint/unified-signatures */

	/**
	 * Extend the template with new values and/or derivation layers.
	 *
	 * @remarks
	 * Mirrors `valueScope()`'s variadic field+derivation slot structure,
	 * minus the trailing config slot. For lifecycle hooks, chain with
	 * {@link ScopeTemplate.extendConfig}.
	 *
	 * Slot 1 may be a field layer or a derivation layer (against the base
	 * `Def`). For two or more arguments, slot 1 must be a field layer and
	 * subsequent slots are derivation layers typed against the accumulated
	 * definition. To extend with only derivations in multi-arg form, pass
	 * `{}` as slot 1.
	 *
	 * @example Add a field
	 * ```ts
	 * const person = base.extendValues({ age: value(0) });
	 * ```
	 *
	 * @example Add a derivation (against the base)
	 * ```ts
	 * const person = base.extendValues({
	 *   fullName: ({ scope }) => `${scope.first.use()} ${scope.last.use()}`,
	 * });
	 * ```
	 *
	 * @example Add fields and a derivation in layered form
	 * ```ts
	 * const person = base.extendValues(
	 *   { first: value<string>(), last: value<string>() },
	 *   { fullName: ({ scope }) => `${scope.first.use()} ${scope.last.use()}` },
	 * );
	 * ```
	 */
	// Implementation signature for the variadic overloads above. The
	// `any` return suppresses the overload-vs-impl variance check that
	// would otherwise reject narrower `ScopeTemplate<AsDef<...>>`
	// overload return types as incompatible with a wider impl return.
	// Public callers see the strict overload return types; this signature
	// is hidden at the call site.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	extendValues(...layers: unknown[]): any {
		if (layers.length === 0) {
			throw new TypeError(
				'ScopeTemplate.extendValues: at least one layer required.',
			);
		}
		// Merge each new layer over the prior definition. Plain-object
		// subtrees deep-merge so a derivation layer can extend a nested
		// object declared in an earlier layer.
		let merged: Record<string, unknown> = { ...this.#rawDefinition };
		for (const layerRaw of layers) {
			const layer = layerRaw as Record<string, unknown>;
			merged = deepMergeLayers(merged, layer);
			// Honor `undefined` as a removal directive so callers can drop
			// a base field by writing `extendValues({ field: undefined })`.
			for (const [key, value] of Object.entries(layer)) {
				if (value === undefined) {
					// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
					delete merged[key];
				}
			}
		}
		// Append extension layers to the base's layer array. Extension
		// layers always live downstream of the base's layers — extension
		// derivations can read all base derivations, but not vice versa.
		const nextLayers: ReadonlyArray<Record<string, unknown>> = [
			...this.#layers,
			...(layers as Array<Record<string, unknown>>),
		];
		return new ScopeTemplate(merged, nextLayers, this.#config);
	}

	/**
	 * Attach lifecycle hooks to the template without changing its
	 * definition. Hooks merge with any hooks already configured, in
	 * declaration order (existing first, then the new layer).
	 *
	 * @param config - lifecycle hooks. `scope` inside each hook is typed
	 *   against the current `Def`.
	 *
	 * @example
	 * ```ts
	 * const person = base.extendConfig({
	 *   onCreate: ({ scope }) => console.log(scope.name.get()),
	 * });
	 * ```
	 */
	extendConfig(config: ScopeConfig<Def>): ScopeTemplate<Def> {
		const mergedConfig = mergeConfigs(
			this.#config,
			config as unknown as ScopeConfig,
		);
		return new ScopeTemplate<Def>(
			this.#rawDefinition,
			this.#layers,
			mergedConfig,
		);
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

// ── Public widening helpers ──────────────────────────────────────────

/**
 * The widest scope-template type — `ScopeTemplate<Record<string, unknown>>`.
 *
 * Use as a cast target inside middleware that's generic over `Def` but
 * needs to attach `$`-methods or read snapshots without knowing the
 * concrete shape. Inside a function whose template is typed as
 * `UnknownValueScope`, the lifecycle-hook `scope` resolves to
 * `GenericScopeInstance`, so writes to dynamically-attached properties
 * type-check cleanly.
 *
 * @example
 * ```ts
 * function withHistory<Def extends Record<string, unknown>>(
 *   template: ScopeTemplate<Def>,
 * ): HistoryTemplate<Def> {
 *   return asUnknownValueScope(template).extendConfig({
 *     onCreate: ({ scope }) => {
 *       scope.$undo = () => {};
 *     },
 *   }) as unknown as HistoryTemplate<Def>;
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments -- explicit Record<string, unknown> documents the loose-shape intent here
export type UnknownValueScope = ScopeTemplate<Record<string, unknown>>;

/**
 * Constraint helper for middleware that operates on templates whose
 * definition must include specific values. Apply as a `Def extends ...`
 * bound on the middleware's generic, then take `ScopeTemplate<Def>` as
 * the parameter.
 *
 * Note: this is a **definition-shape** type, not a template type. It
 * exists because `ScopeTemplate<Def>` is invariant in `Def`, so a
 * template-subtype formulation cannot accept wider concrete templates
 * (e.g., `ScopeTemplate<{count, name}>` would not flow into
 * `ScopeTemplate<{count}>`). Constraining `Def` directly avoids the
 * variance trap.
 *
 * Inside hooks, `scope` retains its generic typing — the constraint
 * informs the call boundary, not the hook body. To access required
 * values with their declared types, read through `$getSnapshot()` or
 * cast `scope` to a known shape. For middleware that attaches new
 * `$`-methods, combine with {@link asUnknownValueScope}.
 *
 * @typeParam RequiredDef - the values the template must declare.
 *
 * @example
 * ```ts
 * function withCountLogger<
 *   Def extends ValueScope<{ count: Value<number> }>,
 * >(template: ScopeTemplate<Def>): ScopeTemplate<Def> {
 *   return template.extendConfig({
 *     onChange: ({ scope }) => {
 *       const snap = scope.$getSnapshot();
 *       console.log(snap.count);
 *     },
 *   });
 * }
 * ```
 */
export type ValueScope<RequiredDef extends Record<string, unknown>> =
	RequiredDef & Record<string, unknown>;

/**
 * Widen a `ScopeTemplate<Def>` to {@link UnknownValueScope}. The runtime
 * value is untouched — this is a typed `as` cast, named to make the
 * widening intentional and reviewable at the call site.
 *
 * @see {@link UnknownValueScope} for usage rationale.
 */
export function asUnknownValueScope<Def extends Record<string, unknown>>(
	template: ScopeTemplate<Def>,
): UnknownValueScope {
	return template as UnknownValueScope;
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
// ── Variadic overloads ───────────────────────────────────────────────
//
// Order at each arity (N args):
//   1. (fields, ...mid-derivs, config)   ← config-trailing path, listed FIRST
//   2. (fields, ...derivs)               ← deriv-only path
//
// The config-trailing overload (whose last param is typed
// `ScopeConfig<...>`) is declared ahead of the deriv-only overload at each
// arity, so a config-shaped trailing literal like
// `valueScope(fields, { onCreate: hook })` resolves to the config form.
// Every derivation slot uses the lenient `DerivationLayer`, so you can
// still name a derivation `onCreate` when a trailing `{}` disambiguator
// follows.
//
// Type accumulation uses `DeepMerge<A, B>` so nested-object subtrees
// compose correctly.

/* eslint-disable @typescript-eslint/unified-signatures */

/**
 * Force a structural `DeepMerge<...>` result into a constraint-satisfying
 * shape so it can pass `ScopeTemplate<Def extends Record<string, unknown>>`
 * checks. Two-step:
 *
 *  1. If `T` already statically extends `Record<string, unknown>` (e.g.,
 *     a generic `Def` constrained at the class level), pass it through
 *     unchanged so the original type identity is preserved (important
 *     for `MapDefinition<Def>` simplification inside middleware that's
 *     generic over `Def`).
 *  2. Otherwise (e.g., a `DeepMerge<...>` mapped result that's
 *     structurally Record-shaped but not constraint-visible),
 *     `Simplify` from type-fest collapses it into a canonical form
 *     TypeScript recognizes as `Record<string, unknown>`.
 *
 * @internal
 */
type AsDef<T> = T extends Record<string, unknown> ? T : Simplify<T>;

// Per-extension accumulator aliases threaded by `.extendValues()`. Like
// `Acc{N}` but rooted on the existing template's `Def` rather than the
// first layer literal, so the prior context passed to deriv layers
// includes everything previously declared on the template.
type ExtAcc1<Prior, L1> = AsDef<DeepMerge<Prior, L1>>;
type ExtAcc2<Prior, L1, L2> = AsDef<DeepMerge<ExtAcc1<Prior, L1>, L2>>;
type ExtAcc3<Prior, L1, L2, L3> = AsDef<DeepMerge<ExtAcc2<Prior, L1, L2>, L3>>;
type ExtAcc4<Prior, L1, L2, L3, L4> = AsDef<
	DeepMerge<ExtAcc3<Prior, L1, L2, L3>, L4>
>;
type ExtAcc5<Prior, L1, L2, L3, L4, L5> = AsDef<
	DeepMerge<ExtAcc4<Prior, L1, L2, L3, L4>, L5>
>;
type ExtAcc6<Prior, L1, L2, L3, L4, L5, L6> = AsDef<
	DeepMerge<ExtAcc5<Prior, L1, L2, L3, L4, L5>, L6>
>;
type ExtAcc7<Prior, L1, L2, L3, L4, L5, L6, L7> = AsDef<
	DeepMerge<ExtAcc6<Prior, L1, L2, L3, L4, L5, L6>, L7>
>;
type ExtAcc8<Prior, L1, L2, L3, L4, L5, L6, L7, L8> = AsDef<
	DeepMerge<ExtAcc7<Prior, L1, L2, L3, L4, L5, L6, L7>, L8>
>;
type ExtAcc9<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9> = AsDef<
	DeepMerge<ExtAcc8<Prior, L1, L2, L3, L4, L5, L6, L7, L8>, L9>
>;
type ExtAcc10<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10> = AsDef<
	DeepMerge<ExtAcc9<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>
>;
type ExtAcc11<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11> = AsDef<
	DeepMerge<ExtAcc10<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>, L11>
>;
type ExtAcc12<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12> = AsDef<
	DeepMerge<ExtAcc11<Prior, L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>, L12>
>;

// Layer-accumulator aliases used by the overload set below. Each step
// deep-merges the next layer literal into the accumulated def and
// re-fits the result into the `Record<string, unknown>` constraint via
// `AsDef` so the next overload's slot types can use it as `Prior`.
type Acc2<L1, L2> = AsDef<DeepMerge<L1, L2>>;
type Acc3<L1, L2, L3> = AsDef<DeepMerge<Acc2<L1, L2>, L3>>;
type Acc4<L1, L2, L3, L4> = AsDef<DeepMerge<Acc3<L1, L2, L3>, L4>>;
type Acc5<L1, L2, L3, L4, L5> = AsDef<DeepMerge<Acc4<L1, L2, L3, L4>, L5>>;
type Acc6<L1, L2, L3, L4, L5, L6> = AsDef<
	DeepMerge<Acc5<L1, L2, L3, L4, L5>, L6>
>;
type Acc7<L1, L2, L3, L4, L5, L6, L7> = AsDef<
	DeepMerge<Acc6<L1, L2, L3, L4, L5, L6>, L7>
>;
type Acc8<L1, L2, L3, L4, L5, L6, L7, L8> = AsDef<
	DeepMerge<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>
>;
type Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9> = AsDef<
	DeepMerge<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>
>;
type Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10> = AsDef<
	DeepMerge<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>
>;
type Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11> = AsDef<
	DeepMerge<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>, L11>
>;
type Acc12<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12> = AsDef<
	DeepMerge<Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>, L12>
>;

// 1 arg
export function valueScope<L1 extends Record<string, unknown>>(
	l1: L1 & FieldLayer<L1>,
): ScopeTemplate<L1>;

// 2 args — config-overload listed FIRST so hook-shaped literals
// resolve to the config form; deriv falls in second
export function valueScope<L1 extends Record<string, unknown>>(
	l1: L1 & FieldLayer<L1>,
	config: ScopeConfig<L1>,
): ScopeTemplate<L1>;
export function valueScope<L1 extends Record<string, unknown>, L2>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
): ScopeTemplate<AsDef<Acc2<L1, L2>>>;

// 3 args
export function valueScope<L1 extends Record<string, unknown>, L2>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	config: ScopeConfig<Acc2<L1, L2>>,
): ScopeTemplate<AsDef<Acc2<L1, L2>>>;
export function valueScope<L1 extends Record<string, unknown>, L2, L3>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
): ScopeTemplate<AsDef<Acc3<L1, L2, L3>>>;

// 4 args
export function valueScope<L1 extends Record<string, unknown>, L2, L3>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	config: ScopeConfig<Acc3<L1, L2, L3>>,
): ScopeTemplate<AsDef<Acc3<L1, L2, L3>>>;
export function valueScope<L1 extends Record<string, unknown>, L2, L3, L4>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
): ScopeTemplate<AsDef<Acc4<L1, L2, L3, L4>>>;

// 5 args
export function valueScope<L1 extends Record<string, unknown>, L2, L3, L4>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	config: ScopeConfig<Acc4<L1, L2, L3, L4>>,
): ScopeTemplate<AsDef<Acc4<L1, L2, L3, L4>>>;
export function valueScope<L1 extends Record<string, unknown>, L2, L3, L4, L5>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
): ScopeTemplate<Acc5<L1, L2, L3, L4, L5>>;

// 6 args
export function valueScope<L1 extends Record<string, unknown>, L2, L3, L4, L5>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	config: ScopeConfig<Acc5<L1, L2, L3, L4, L5>>,
): ScopeTemplate<AsDef<Acc5<L1, L2, L3, L4, L5>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
): ScopeTemplate<AsDef<Acc6<L1, L2, L3, L4, L5, L6>>>;

// 7 args
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	config: ScopeConfig<Acc6<L1, L2, L3, L4, L5, L6>>,
): ScopeTemplate<AsDef<Acc6<L1, L2, L3, L4, L5, L6>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
): ScopeTemplate<AsDef<Acc7<L1, L2, L3, L4, L5, L6, L7>>>;

// 8 args
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	config: ScopeConfig<Acc7<L1, L2, L3, L4, L5, L6, L7>>,
): ScopeTemplate<AsDef<Acc7<L1, L2, L3, L4, L5, L6, L7>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
): ScopeTemplate<AsDef<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>>>;

// 9 args
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	config: ScopeConfig<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>>,
): ScopeTemplate<AsDef<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
): ScopeTemplate<AsDef<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>>>;

// 10 args
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	config: ScopeConfig<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>>,
): ScopeTemplate<AsDef<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
	L10,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	l10: L10 & DerivationLayer<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
): ScopeTemplate<AsDef<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>>>;

// 11 args
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
	L10,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	l10: L10 & DerivationLayer<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
	config: ScopeConfig<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>>,
): ScopeTemplate<AsDef<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
	L10,
	L11,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	l10: L10 & DerivationLayer<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
	l11: L11 &
		DerivationLayer<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>, L11>,
): ScopeTemplate<AsDef<Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>>>;

// 12 args
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
	L10,
	L11,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	l10: L10 & DerivationLayer<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
	l11: L11 &
		DerivationLayer<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>, L11>,
	config: ScopeConfig<Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>>,
): ScopeTemplate<AsDef<Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>>>;
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
	L10,
	L11,
	L12,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	l10: L10 & DerivationLayer<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
	l11: L11 &
		DerivationLayer<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>, L11>,
	l12: L12 &
		DerivationLayer<Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>, L12>,
): ScopeTemplate<
	AsDef<Acc12<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12>>
>;

// 13 args (final: field + 11 derivation layers + config)
export function valueScope<
	L1 extends Record<string, unknown>,
	L2,
	L3,
	L4,
	L5,
	L6,
	L7,
	L8,
	L9,
	L10,
	L11,
	L12,
>(
	l1: L1 & FieldLayer<L1>,
	l2: L2 & DerivationLayer<L1, L2>,
	l3: L3 & DerivationLayer<Acc2<L1, L2>, L3>,
	l4: L4 & DerivationLayer<Acc3<L1, L2, L3>, L4>,
	l5: L5 & DerivationLayer<Acc4<L1, L2, L3, L4>, L5>,
	l6: L6 & DerivationLayer<Acc5<L1, L2, L3, L4, L5>, L6>,
	l7: L7 & DerivationLayer<Acc6<L1, L2, L3, L4, L5, L6>, L7>,
	l8: L8 & DerivationLayer<Acc7<L1, L2, L3, L4, L5, L6, L7>, L8>,
	l9: L9 & DerivationLayer<Acc8<L1, L2, L3, L4, L5, L6, L7, L8>, L9>,
	l10: L10 & DerivationLayer<Acc9<L1, L2, L3, L4, L5, L6, L7, L8, L9>, L10>,
	l11: L11 &
		DerivationLayer<Acc10<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10>, L11>,
	l12: L12 &
		DerivationLayer<Acc11<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11>, L12>,
	config: ScopeConfig<Acc12<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12>>,
): ScopeTemplate<
	AsDef<Acc12<L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12>>
>;

/**
 * Single-object form. Accepts a mixed literal containing values,
 * derivations, async derivations, refs, and nested objects in one
 * record. Derivation `({ scope })` parameters need explicit annotations
 * (`SyncDerivationContext<Fields>` / `AsyncDerivationContext<Fields>`)
 * because TS cannot contextually type them from a circular `Def`
 * inference within a single literal.
 *
 * For new code prefer the variadic form, which gives the same surface
 * with automatic contextual typing. The single-literal form is kept for
 * cases where a single literal reads more naturally — typically small
 * scopes that mix one or two derivations into a values literal.
 */
export function valueScope<Def extends Record<string, unknown>>(
	definition: Def,
	config?: ScopeConfig<Def>,
): ScopeTemplate<Def>;

/* eslint-enable @typescript-eslint/unified-signatures */

/**
 * Define a reactive scope template.
 *
 * @see {@link ScopeTemplate} for the produced template's API.
 * @see `docs/extending.md` for the variadic API.
 *
 * @example Field layer only
 * ```ts
 * const person = valueScope({
 *   first: value('Alice'),
 *   last: value('Smith'),
 * });
 * ```
 *
 * @example Fields + derivation layer
 * ```ts
 * const person = valueScope(
 *   { first: value<string>(), last: value<string>() },
 *   { full: ({ scope }) => `${scope.first.use()} ${scope.last.use()}` },
 * );
 * ```
 *
 * @example Fields + derivations + config
 * ```ts
 * const cart = valueScope(
 *   { price: value(0), qty: value(0) },
 *   { subtotal: ({ scope }) => scope.price.use() * scope.qty.use() },
 *   { onCreate: ({ scope }) => {} },
 * );
 * ```
 */
export function valueScope(...args: unknown[]): ScopeTemplate {
	const { definition, layers, config } = collapseLayers(args);
	return new ScopeTemplate(definition, layers, config);
}

// ── Layer collapse ───────────────────────────────────────────────────

/**
 * Known config-layer keys. The runtime treats the last variadic arg as
 * a config layer if every own key on it appears in this set (an empty
 * object qualifies, which is how the trailing `{}` disambiguator works).
 * Anything else is a derivation layer.
 * @internal
 */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
	'onCreate',
	'onDestroy',
	'onChange',
	'beforeChange',
	'onUsed',
	'onUnused',
	'validate',
	'allowUndeclaredProperties',
]);

function isConfigLayer(value: unknown): value is ScopeConfig {
	if (!value || typeof value !== 'object') return false;
	for (const key of Object.keys(value)) {
		if (!CONFIG_KEYS.has(key)) return false;
	}
	return true;
}

/**
 * Collapse a variadic args list `(fields, ...derivations, config?)` into
 * a single merged definition plus optional config. The first arg is the
 * field layer; the last arg is the config layer if (and only if) every
 * own key on it is a known config key; everything between is a
 * derivation layer.
 *
 * Plain-object subtrees are deep-merged so a derivation layer can extend
 * a field layer's nested object. Reactive primitives and functions are
 * leaves; B replaces A on collision.
 *
 * @internal
 */
function collapseLayers(args: unknown[]): {
	definition: Record<string, unknown>;
	layers: ReadonlyArray<Record<string, unknown>>;
	config: ScopeConfig | undefined;
} {
	if (args.length === 0) {
		throw new TypeError('valueScope: at least one layer required.');
	}

	let lastLayerIndex = args.length - 1;
	let config: ScopeConfig | undefined;
	// Only consider the LAST arg as a config layer; middle args are
	// always derivation layers, even if they happen to be empty or to
	// contain only hook-named entries.
	if (args.length > 1 && isConfigLayer(args[lastLayerIndex])) {
		config = args[lastLayerIndex] as ScopeConfig;
		lastLayerIndex -= 1;
	}

	// Layer-by-layer record of every non-config arg, preserved for the
	// flush pipeline. Index 0 is the field layer; subsequent entries
	// are derivation layers, in declaration order.
	const layers: Array<Record<string, unknown>> = [];
	for (let i = 0; i <= lastLayerIndex; i += 1) {
		layers.push(args[i] as Record<string, unknown>);
	}

	let merged = layers[0]!;
	for (let i = 1; i < layers.length; i += 1) {
		merged = deepMergeLayers(merged, layers[i]!);
	}

	return { definition: merged, layers, config };
}

/**
 * Runtime counterpart to the `DeepMerge<A, B>` type. Plain-object
 * subtrees recurse; leaves (reactive primitives, functions, anything
 * non-plain-object) follow shallow-override semantics (B replaces A).
 * @internal
 */
function deepMergeLayers(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...a };
	for (const [key, bValue] of Object.entries(b)) {
		const aValue = a[key];
		if (isPlainGroup(aValue) && isPlainGroup(bValue)) {
			result[key] = deepMergeLayers(
				aValue as Record<string, unknown>,
				bValue as Record<string, unknown>,
			);
		} else {
			result[key] = bValue;
		}
	}
	return result;
}

/**
 * Predicate matching the type-level `IsGroup<T>` check. A plain-object
 * subtree is anything that isn't a reactive primitive, ref, collection,
 * or function. We rely on `[Symbol.toStringTag]` being absent (none of
 * the reactive classes set it) and the object having a plain-Object
 * prototype chain.
 * @internal
 */
function isPlainGroup(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (typeof (value as { __brand?: unknown }).__brand === 'string')
		return false;
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null;
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
	layers: ReadonlyArray<Record<string, unknown>> = [],
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

	// Attach static entries onto both trees BEFORE derivations run. Sync
	// derivations are eagerly evaluated by `setupSyncDerivations` via the
	// `effect()` that mirrors the computed into the store, so any static
	// fields read through `scope.<name>` must be in place first.
	attachStaticEntries(definition, instance, derivationScope);

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
	freezeDerivationGroups(definition, derivationScope, definition.groups[0]!);

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
		layers,
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

	// Wire hooks. The runtime `context.scope` is the live ScopeInstance
	// (branded as ScopeNode at the InstanceStore boundary), so the cast
	// to the user-facing hook context type is sound at runtime.
	if (config?.onChange) {
		const onChange = config.onChange;
		store.onChangeHook = (context) => {
			onChange(context as Parameters<typeof onChange>[0]);
		};
	}

	if (config?.beforeChange) {
		const beforeChange = config.beforeChange;
		store.beforeChangeHook = (context) => {
			beforeChange(context as Parameters<typeof beforeChange>[0]);
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

		// Release the transitive child subscriptions on parent $destroy too.
		// `store.destroy()` only flips a flag — it does not invoke
		// `onUnusedHook` — so a parent destroyed *while still subscribed*
		// would otherwise leave every referenced child believing it still
		// has a live subscriber. The children's own onUnused (and any
		// onUsed cleanup they registered) would never fire, leaking their
		// reactive subscriptions for the lifetime of the process.
		instanceCleanups.push(() => {
			for (const unsub of childUntrackFns) unsub();
			childUntrackFns.length = 0;
		});
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

	// Add child groups recursively. Groups are NOT frozen here so static
	// entries can be mirrored onto them after build; freezing happens via
	// `freezeDerivationGroups` once mirroring is done.
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		node[fieldName] = buildDerivationGroupNode(definition, store, childGroup);
	}

	return node;
}

/** Recursively freeze nested groups on the derivation scope tree. @internal */
function freezeDerivationGroups(
	definition: ScopeDefinitionMeta,
	derivationScope: Record<string, unknown>,
	group: GroupMeta,
): void {
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		const child = derivationScope[fieldName] as Record<string, unknown>;
		freezeDerivationGroups(definition, child, childGroup);
		Object.freeze(child);
	}
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
	/** Flushable deferral powering `ctx.deferBy`, governed by this run's signal. */
	deferral: Deferral;
	/** Resolves when this run settles (after its result/error is written). */
	completion: Promise<void>;
	/** Observable-output counter; bumped on each `ctx.set` emit. */
	emitCount: number;
	/** `true` once the run has settled (result/error written). */
	settled: boolean;
	/** Resolves on the next emit, deferral arm, or completion. */
	nextWake: () => Promise<void>;
}

/** Mutable ref to the current async run. Shared by the scope tree so it doesn't need rebuilding on every re-run. @internal */
interface AsyncRunRef {
	current: AsyncRun;
	scheduleRerun: () => void;
}

/**
 * Safety bound for the async-derivation flush chase. `flush()` expedites a
 * run to its next output; this caps the chase so a derivation that defers
 * in a loop without ever emitting can't hang flush() (and `$flush()`).
 * Deferrals are expedited (not timed), so legitimate runs settle in a
 * handful of passes — this only bites a genuinely non-terminating,
 * non-emitting loop.
 */
const FLUSH_CHASE_CAP = 1_000;

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
				const deferral = createDeferral(controller.signal);
				let resolveCompletion!: () => void;
				const completion = new Promise<void>((resolve) => {
					resolveCompletion = resolve;
				});
				// Flush instrumentation. `wake()` fires on each emit, deferral
				// arm, and completion; the flush chase (in `_flushFns`) waits on
				// it to advance the run to its next output.
				let wakeWaiters: (() => void)[] = [];
				const wake = (): void => {
					const waiters = wakeWaiters;
					wakeWaiters = [];
					for (const resolve of waiters) resolve();
				};
				runRef.current = {
					controller,
					subscriptions: new Map(),
					cleanups: [],
					deferral,
					completion,
					emitCount: 0,
					settled: false,
					nextWake: () =>
						new Promise<void>((resolve) => {
							wakeWaiters.push(resolve);
						}),
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
						// Batch the data + asyncState writes so React sees one
						// atomic update; otherwise downstream computeds (e.g.
						// sync derivations reading this async slot) can be one
						// step stale when consumers re-render off the async
						// state alone.
						batchSets(() => {
							// Route through the change-emitting path so
							// `onChange` observers see async writes.
							// `beforeChange` is skipped: this is a computed
							// value, not a user mutation.
							store._writeToSignal(slot, value, {
								skipBeforeChange: true,
							});
							if (asyncSignal) {
								asyncSignal.value = resolvedAsyncState(value);
							}
						});
						// An emit is an observable output: count it and wake any
						// in-flight flush so it can stop chasing.
						run.emitCount += 1;
						wake();
					},
					onCleanup: (fn: () => void) => {
						run.cleanups.push(fn);
					},
					deferBy: (ms: number) => {
						const promise = deferral.deferBy(ms);
						// Wake any in-flight flush so it can expedite this fresh
						// deferral instead of waiting out its real timer.
						wake();
						return promise;
					},
					previousValue: lastValue,
				};

				// Run the async function
				try {
					const promise = derivationFn(context) as Promise<unknown>;
					// The synchronous phase (up to the first `await`) is done —
					// drop the cycle-detection marker now. Genuine cycles
					// (synchronous self-`use()`) are caught during that phase;
					// keeping the marker through the async phase would falsely
					// flag a *downstream* async derivation that legitimately
					// reads this still-pending one (e.g. preview → results).
					store.runningAsync.delete(slot);
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
								// Batch the data + asyncState writes so React
								// sees one atomic update — otherwise downstream
								// sync derivations reading this slot can be
								// stale by one render cycle.
								batchSets(() => {
									// Route through the change-emitting path so
									// `onChange` observers see the resolved
									// value.
									store._writeToSignal(slot, result, {
										skipBeforeChange: true,
									});
									if (asyncSignal) {
										asyncSignal.value = resolvedAsyncState(result);
									}
								});
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
						})
						.finally(() => {
							run.settled = true;
							wake();
							resolveCompletion();
						});
				} catch (error) {
					store.runningAsync.delete(slot);
					if (asyncSignal) {
						asyncSignal.value = errorAsyncState(asyncSignal.peek(), error);
					}
					run.settled = true;
					wake();
					resolveCompletion();
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

			// Register flush: expedite the active deferral and chase the run —
			// re-expediting each freshly-armed deferral — until it emits (set),
			// completes, or hits FLUSH_CHASE_CAP. The cap guards a derivation
			// that defers in a loop without ever emitting; without it, flush()
			// (and $flush()) would hang. Registering `nextWake()` before
			// `deferral.flush()` is load-bearing: flush schedules the run's
			// continuation as a microtask, so the waiter must already be in
			// place to catch the emit / arm / completion it produces.
			store._flushFns.set(slot, async () => {
				const run = runRef.current;
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (!run) return;
				const emitMark = run.emitCount;
				for (let pass = 0; pass < FLUSH_CHASE_CAP; pass += 1) {
					if (run.settled || run.emitCount > emitMark) return;
					const woke = run.nextWake();
					run.deferral.flush();
					await Promise.race([woke, run.completion]);
				}
				console.warn(
					`valuse: .flush() on derivation "${meta.path}" gave up after ` +
						`${String(FLUSH_CHASE_CAP)} iterations — it appears to defer in a ` +
						'loop without ever emitting a value (via set/return) or completing, ' +
						'so flush() cannot settle it.',
				);
			});

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
				return validateFn({
					scope: derivationScope as Parameters<typeof validateFn>[0]['scope'],
				});
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
	derivationScope?: Record<string, unknown>,
): void {
	for (const [path, value] of definition.staticEntries) {
		setNestedValue(instance, path, value);
		// Mirror onto the derivation scope too so `scope.<staticField>` resolves
		// inside derivations / hooks instead of being undefined.
		if (derivationScope) setNestedValue(derivationScope, path, value);
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
	layers: ReadonlyArray<Record<string, unknown>> = [],
): void {
	// Register a Preact dependency on every slot signal. Used by the snapshot
	// invalidator, `$subscribe`, and `instance._trackAll` (the derivation-scope
	// ref hook). Coarse-grained by design.
	const trackAllSlots = (): void => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			void store.signals[slot]!.value;
		}
	};

	// Group slots by declared layer for the `$flush()` cascade. Each
	// top-level key maps to the last layer it appears in; slots inherit
	// their top-level path segment's layer (defaulting to the field
	// layer). With no layer info, everything flushes as one group.
	const segmentLayer = new Map<string, number>();
	for (const [index, layer] of layers.entries()) {
		for (const [key, entry] of Object.entries(layer)) {
			if (entry !== undefined) segmentLayer.set(key, index);
		}
	}
	const layerSlots: number[][] =
		layers.length > 0 ? layers.map(() => []) : [[]];
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const segment = definition.slots[slot]!.path.split('.')[0]!;
		const layerIndex = segmentLayer.get(segment) ?? 0;
		layerSlots[layerIndex]!.push(slot);
	}

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
		// Non-object input (null, undefined, primitives) has no fields to apply.
		// Warn and skip so a stray value can't crash hydration with a cryptic
		// native "Cannot convert undefined or null to object" — and so the
		// behavior is consistent across all non-conforming inputs. The declared
		// type is always an object, but runtime callers (casts, parsed JSON,
		// hydration) can pass anything, so we narrow through `unknown`.
		const raw = data as unknown;
		if (typeof raw !== 'object' || raw === null) {
			console.warn(
				`valuse: $setSnapshot expected a plain object, received ${raw === null ? 'null' : typeof raw}. Skipping.`,
			);
			return;
		}
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

	// Expedite all pending deferred work (pipe debounces, async-derivation
	// deferBy) layer by layer in dependency order. Awaiting each layer
	// before the next lets a downstream layer's re-run (triggered when an
	// upstream value commits) see the resolved upstream value.
	//
	// A single ordered pass isn't always enough: an upstream commit
	// schedules the downstream re-run on a microtask, which can land just
	// after we've flushed that downstream layer. So we repeat the ordered
	// cascade until a pass leaves no async derivation running. Bounded by
	// layer depth (+slack) to avoid spinning on pathological graphs.
	instance.$flush = async (): Promise<void> => {
		const maxPasses = layerSlots.length + 2;
		for (let pass = 0; pass < maxPasses; pass++) {
			for (const slots of layerSlots) {
				await Promise.all(slots.map((slot) => store.flushSlot(slot)));
				// A layer's commits schedule downstream re-runs on a
				// microtask. Drain it so the next layer flushes the re-run
				// (reading this layer's resolved value), not a stale run.
				await Promise.resolve();
			}
			if (store.runningAsync.size === 0) return;
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
