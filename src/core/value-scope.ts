/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
	signal as createSignal,
	computed,
	effect,
	type ReadonlySignal,
} from './signal.js';
import { buildScopeDefinition } from './scope-definition.js';
import { InstanceStore } from './instance-store.js';
import { brandAsScope } from './field-value.js';
import { ScopeMap } from './scope-map.js';
import { mergeConfigs, type ScopeConfig } from './scope-config.js';
import { collapseLayers, deepMergeLayers } from './scope-layers.js';
import { setNestedValue } from './scope-snapshot.js';
import { setupAsyncDerivations } from './scope-async-derivations.js';
import { setupValidation } from './scope-validation.js';
import { resolveRefs } from './scope-refs.js';
import { fireOnCreate, wireLifecycleHooks } from './scope-lifecycle.js';
import {
	buildDerivationScopeTree,
	freezeDerivationGroups,
	buildInstanceTree,
	freezeChildGroups,
	attachStaticEntries,
} from './scope-tree.js';
import { attachDollarMethods } from './scope-instance-api.js';
import type { ScopeDefinitionMeta } from './slot-meta.js';
import type { ScopeNode } from './types.js';
import type {
	ScopeInstance,
	ValueInputOf,
	DerivationLayer,
	FieldLayer,
	DeepMerge,
} from './scope-types.js';
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

// --- Instance creation ---

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
	// shared refs just attach the existing source. Must happen before
	// derivation setup so derivations can reference refs.
	const {
		resolvedRefs,
		factoryRefInstances,
		factoryRefDestroyables,
		transitiveLifecycleRefs,
	} = resolveRefs(definition, derivationScope);

	// Build the instance object tree. Dense arrays indexed by slot / group
	// index (every slot and group is populated by `buildInstanceTree`).
	const nodesBySlot: ScopeNode[] = Array.from({ length: definition.slotCount });
	const nodesByGroup: ScopeNode[] = Array.from({
		length: definition.groups.length,
	});
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

	// Wire change/usage lifecycle hooks (+ transitive onUsed/onUnused).
	wireLifecycleHooks(
		store,
		instance,
		config,
		transitiveLifecycleRefs,
		instanceCleanups,
	);

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

/** Set up sync derivations using Preact computed(). @internal */
function setupSyncDerivations(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	derivationScope: Record<string, unknown>,
	cleanups: (() => void)[],
): void {
	for (const slot of definition.derivedSlots) {
		const meta = definition.slots[slot]!;
		const derivationFn = meta.derivationFn;
		if (!derivationFn) continue;

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
		store.registerRecompute(slot, () => {
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
