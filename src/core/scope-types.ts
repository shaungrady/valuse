/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Type-level inference utilities that map a scope definition to its instance type.
 *
 * Given a definition like:
 * ```ts
 * valueScope({
 *   name: value<string>(),
 *   age: value(30),
 *   fullName: ({ scope }) => `${scope.name.use()} ...`,
 *   job: { title: value<string>() },
 * })
 * ```
 *
 * The instance type inferred is:
 * ```ts
 * {
 *   name: FieldValue<string | undefined>;
 *   age: FieldValue<number>;
 *   fullName: FieldDerived<string>;
 *   job: Readonly<{ title: FieldValue<string | undefined> }>;
 *   $destroy(): void;
 *   ...
 * }
 * ```
 */

import type { Value } from './value.js';
import type { ValueSchema } from './value-schema.js';
import type { ValuePlain } from './value-plain.js';
import type { ValueRef, ResolvedRef } from './value-ref.js';
import type { ValueArray } from './value-array.js';
import type { ValueMap } from './value-map.js';
import type { ValueSet } from './value-set.js';
import type {
	FieldValue,
	FieldValueSchema,
	FieldValuePlain,
	FieldDerived,
	FieldAsyncDerived,
} from './field-value.js';
import type { Unsubscribe } from './types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Flatten an intersection into a single object type for readability.
 * @internal
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * `true` when `T` is a plain-object subtree (nested fields), `false` for
 * reactive primitives, refs, collections, and functions. Used by both
 * the instance mapping (`MapEntry`) and the derivation context mapping
 * (`DerivLeaf`) to decide when to recurse into a subtree vs treat it as
 * a leaf.
 */
export type IsGroup<T> =
	T extends Value<any, any> ? false
	: T extends ValueSchema<any, any> ? false
	: T extends ValuePlain<any, any> ? false
	: T extends ValueRef<any> ? false
	: T extends ValueArray<any, any> ? false
	: T extends ValueMap<any, any> ? false
	: T extends ValueSet<any> ? false
	: T extends (...args: any[]) => any ? false
	: T extends Record<string, unknown> ? true
	: false;

// ── Definition → Instance mapping ────────────────────────────────────

/**
 * Map a single definition entry to its instance field type.
 *
 * - `Value<In, Out>` becomes `FieldValue<In, Out>`
 * - `ValueSchema<In, Out>` becomes `FieldValueSchema<In, Out>`
 * - `ValuePlain<V>` becomes `FieldValuePlain<V, V>`
 * - `ValueRef<S>` becomes the resolved source (factory's return or `S` itself)
 * - async functions become `FieldAsyncDerived<T>`
 * - sync functions become `FieldDerived<T>`
 * - plain objects become `Readonly<MapDefinition<T>>`
 * - everything else passes through unchanged
 *
 * @internal
 */
type MapEntry<T> =
	T extends ValueSchema<infer In, infer Out> ? FieldValueSchema<In, Out>
	: T extends Value<infer In, infer Out> ? FieldValue<In, Out>
	: T extends ValuePlain<infer V, true> ? Pick<FieldValuePlain<V, V>, 'get'>
	: T extends ValuePlain<infer V, boolean> ? FieldValuePlain<V, V>
	: T extends ValueRef<infer S> ? ResolvedRef<S>
	: T extends ValueArray<any, any> ? T
	: T extends ValueMap<any, any> ? T
	: T extends ValueSet<any> ? T
	: T extends (...args: any[]) => Promise<infer A> ?
		FieldAsyncDerived<Exclude<A, void>>
	: T extends (...args: any[]) => infer R ? FieldDerived<R>
	: IsGroup<T> extends true ?
		T extends Record<string, unknown> ?
			Readonly<MapDefinition<T>>
		:	T
	:	T;

/**
 * Map every key of a definition to its instance field type.
 *
 * @typeParam Def - the raw scope definition record.
 */
export type MapDefinition<Def> = {
	readonly [K in keyof Def]: MapEntry<Def[K]>;
};

// ── Derivation context typing ────────────────────────────────────────
//
// In an ideal world, `valueScope({ ..., greeting: ({ scope }) => ... })`
// would contextually type `scope` from the surrounding definition. That
// would require TS to resolve a circular constraint (Def includes the
// derivation function, whose body type-check depends on Def) — even with
// `NoInfer`, TS bails and `scope` falls back to implicit `any`.
//
// The workaround the codebase uses is to declare a field-only alias and
// annotate the derivation context with `SyncDerivationContext<Fields>`:
//
// ```ts
// type PersonFields = {
//   firstName: Value<string>;
//   lastName: Value<string>;
// };
// type PersonCtx = SyncDerivationContext<PersonFields>;
//
// const person = valueScope({
//   firstName: value<string>('A'),
//   lastName: value<string>('B'),
//   fullName: ({ scope }: PersonCtx) =>
//     `${scope.firstName.use()} ${scope.lastName.use()}`,
// });
// ```
//
// More verbose than implicit inference, but every read inside the
// derivation is then properly typed (no `any` leaking out).

/**
 * The shape of a field as it appears in a derivation context. Each leaf
 * is a `{ get, use }` wrapper. `.use()` returns the value directly
 * (NOT a `[value, setter]` tuple as on `ScopeInstance`), and is
 * tracked for re-evaluation when the field changes.
 *
 * For `valueRef(scopeMap)`, the wrapper's `.use()` / `.get()` hand back
 * the underlying `ScopeMap`. For `valueRef(scopeInstance)`, the wrapper
 * hands back the live instance. For scalar refs, the wrapper hands back
 * the resolved value.
 *
 * @typeParam T - a single definition entry type.
 */
export type DerivLeaf<T> =
	T extends Value<any, infer Out> ? { get(): Out; use(): Out }
	: T extends ValueSchema<any, infer Out> ? { get(): Out; use(): Out }
	: T extends ValuePlain<infer V, any> ? { get(): V; use(): V }
	: T extends ValueRef<infer S> ?
		{ get(): ResolvedRef<S>; use(): ResolvedRef<S> }
	: T extends ValueArray<any, infer Out> ?
		{ get(): readonly Out[]; use(): readonly Out[] }
	: T extends ValueMap<infer K, infer V> ?
		{ get(): ReadonlyMap<K, V>; use(): ReadonlyMap<K, V> }
	: T extends ValueSet<infer V> ?
		{ get(): ReadonlySet<V>; use(): ReadonlySet<V> }
	: T extends (...args: any[]) => Promise<infer A> ?
		{
			get(): Exclude<A, void> | undefined;
			use(): Exclude<A, void> | undefined;
		}
	: T extends (...args: any[]) => infer R ? { get(): R; use(): R }
	: T;

/**
 * Alias retained while the variadic refactor lands so callers that still
 * import `DerivationLeaf` continue to compile. Prefer `DerivLeaf`.
 * @deprecated Use `DerivLeaf` instead.
 * @internal
 */
export type DerivationLeaf<T> = DerivLeaf<T>;

/**
 * Map a definition to its derivation-context scope shape.
 *
 * Each field becomes a {@link DerivLeaf} (a `{ get, use }` wrapper).
 * Nested subtrees recurse. This intentionally differs from
 * `ScopeInstance<Def>` because reads inside a derivation go through
 * `DerivationWrap`, which returns values directly (not React-hook
 * tuples).
 *
 * @typeParam Def - the field-only definition record.
 */
export type DerivScope<Def extends Record<string, unknown>> = {
	readonly [K in keyof Def]: Def[K] extends Record<string, unknown> ?
		IsGroup<Def[K]> extends true ?
			Readonly<DerivScope<Def[K]>>
		:	DerivLeaf<Def[K]>
	:	DerivLeaf<Def[K]>;
};

/**
 * Unified derivation context for sync AND async derivations. All five
 * fields are always provided by the runtime; which ones are meaningful
 * depends on the derivation's style.
 *
 * - `scope` and `previousValue` are useful in BOTH sync and async
 *   derivations. `previousValue` enables stateful sync patterns like
 *   trend detection (`current > previousValue`) or smoothing.
 * - `signal`, `set`, and `onCleanup` are async-only. Sync derivations
 *   should ignore them.
 *
 * The fields show up on every derivation's ctx because TypeScript can't
 * discriminate per-entry between sync and async slots without
 * destabilizing inference (see `docs/proposals/variadic-scope-api.md`).
 *
 * @typeParam Prior - the accumulated definition seen by this layer.
 */
export interface DerivCtx<Prior extends Record<string, unknown>> {
	/**
	 * Reactive scope. Read other fields via `scope.<field>.use()` (tracked)
	 * or `.get()` (untracked).
	 */
	scope: DerivScope<Prior>;
	/**
	 * AbortSignal that fires when a tracked dependency changes or the
	 * instance is destroyed. Async-only; sync derivations should ignore.
	 */
	signal: AbortSignal;
	/**
	 * Push an intermediate value before the final `return`. Async-only;
	 * sync derivations should ignore (they push via `return`).
	 */
	set: (value: unknown) => void;
	/**
	 * Register cleanup for re-run or destroy. Async-only; sync derivations
	 * should ignore (they have no lifecycle between calls).
	 */
	onCleanup: (fn: () => void) => void;
	/**
	 * Abortable + flushable sleep. Resolves after `ms`, rejects if the run
	 * aborts (dep change or destroy), resolves early if the derivation's
	 * `.flush()` is called. Async-only; sync derivations should ignore.
	 */
	deferBy: (ms: number) => Promise<void>;
	/**
	 * The previous value this derivation produced, or `undefined` on the
	 * first run. Useful in both sync and async derivations for patterns
	 * that depend on the prior result (trend detection, smoothing, etc.).
	 * Cast to the derivation's return type when reading.
	 */
	previousValue: unknown;
}

/**
 * Type expected at a Derivation Layer arg slot. Each entry is a function
 * whose ctx is contextually typed against `Prior`. Used as an
 * intersection (`L & DerivationLayer<Prior, L>`) on the overload's
 * parameter to provide contextual typing without introducing an `any`
 * constraint that would defeat the purpose.
 *
 * @typeParam Prior - the accumulated definition seen by this layer.
 * @typeParam L - the user-provided layer literal.
 */
export type DerivationLayer<Prior extends Record<string, unknown>, L> = {
	[K in keyof L]: (ctx: DerivCtx<Prior>) => unknown;
};

/**
 * Strict variant of {@link DerivationLayer} for the LAST derivation-layer
 * slot at each arity (i.e., when no config layer follows). Entries with
 * config-shaped key names collapse to `never`, so the call falls through
 * to the matching config-layer overload.
 *
 * This is what makes `valueScope(fields, { onCreate: hook })` resolve to
 * the config-layer overload while `valueScope(fields, { onCreate: deriv },
 * {})` (with a trailing `{}` disambiguator) resolves to the
 * derivation-layer-then-config overload.
 *
 * @typeParam Prior - the accumulated definition seen by this layer.
 * @typeParam L - the user-provided layer literal.
 */
export type LastDerivationLayer<Prior extends Record<string, unknown>, L> = {
	[K in keyof L]: K extends ConfigKey ? never
	:	(ctx: DerivCtx<Prior>) => unknown;
};

/**
 * Reserved key names that appear at the config-layer position. Used by
 * {@link LastDerivationLayer} to discriminate config from derivation in
 * 2-arg `(fields, X)` and (N+1)-arg `(fields, ...derivs, X)` calls.
 *
 * @internal
 */
type ConfigKey =
	| 'onCreate'
	| 'onDestroy'
	| 'onChange'
	| 'beforeChange'
	| 'onUsed'
	| 'onUnused'
	| 'validate'
	| 'allowUndeclaredProperties';

/**
 * Same as {@link DerivationLayer}, but for `.extend()` derivation layers.
 * Sees the full prior definition, including any keys being overridden in
 * this layer.
 *
 * Type-level sibling/self-exclusion via `Omit<Prior, keyof L>` was
 * attempted but doesn't reliably fire: TypeScript resolves `keyof L` to
 * `string` (wide) during contextual typing of the literal, which makes
 * `Omit` strip *all* keys rather than just the ones being defined. The
 * runtime catches actual cycles (sibling-cycle or self-reference) on
 * first evaluation via Preact-signals' computed cycle detection.
 *
 * @typeParam Prior - the accumulated definition seen by this layer.
 * @typeParam L - the user-provided layer literal.
 */
export type ExtendDerivationLayer<
	Prior extends Record<string, unknown>,
	L,
> = DerivationLayer<Prior, L>;

/**
 * Field Layer entry constraint: rejects functions so a function in the
 * field-layer slot fails at the type level. Used as an intersection
 * (`L & FieldLayer<L>`) on the field-layer overload parameter.
 *
 * @typeParam L - the user-provided layer literal.
 */
export type FieldLayer<L> = { [K in keyof L]: FieldEntry<L[K]> };

/**
 * @internal — the per-entry predicate for {@link FieldLayer}.
 */
type FieldEntry<T> = T extends (...args: any[]) => any ? never : T;

/**
 * Deep merge `B` into `A`. Plain-object subtrees recurse; reactive leaves
 * and functions are leaves that follow shallow-override semantics (B
 * replaces A). Used as the type-level layer accumulator.
 *
 * Keys in `B` whose value type is exactly `undefined` are removed from
 * the merged result, matching the runtime field-removal directive
 * (`extendValues({ field: undefined })`).
 *
 * @typeParam A - the prior accumulated definition.
 * @typeParam B - the new layer being merged.
 */
export type DeepMerge<A, B> = {
	[K in keyof A | keyof B as K extends keyof B ?
		[B[K]] extends [undefined] ?
			never
		:	K
	:	K]: K extends keyof B ?
		K extends keyof A ?
			IsGroup<A[K]> extends true ?
				IsGroup<B[K]> extends true ?
					DeepMerge<A[K], B[K]>
				:	B[K]
			:	B[K]
		:	B[K]
	: K extends keyof A ? A[K]
	: never;
};

/**
 * Context passed to a sync derivation function. `scope.<field>.use()`
 * returns the field's value directly (tracked); `.get()` is the
 * untracked read.
 *
 * @typeParam Def - the field-only definition record (no derivations).
 *
 * @example
 * ```ts
 * type Fields = { name: Value<string> };
 * type Ctx = SyncDerivationContext<Fields>;
 *
 * valueScope({
 *   name: value<string>(),
 *   greeting: ({ scope }: Ctx) => `Hello ${scope.name.use()}`,
 * });
 * ```
 */
export interface SyncDerivationContext<Def extends Record<string, unknown>> {
	scope: DerivScope<Def>;
}

/**
 * Context passed to an async derivation function.
 *
 * `scope` is typed against the surrounding definition. `set` and
 * `previousValue` are intentionally loosely typed (`unknown`) so the
 * user can narrow them via their own parameter annotation — streaming
 * derivations that return `void` would otherwise be forced through a
 * `never`-typed `set` because there's no return value to infer the
 * streamed type from.
 *
 * @typeParam Def - the field-only definition record (no derivations).
 */
export interface AsyncDerivationContext<Def extends Record<string, unknown>> {
	scope: DerivScope<Def>;
	signal: AbortSignal;
	set: (value: unknown) => void;
	onCleanup: (fn: () => void) => void;
	previousValue: unknown;
}

/**
 * Context passed to scope lifecycle hooks (`onCreate`, `onChange`,
 * `onDestroy`, etc.). Unlike derivations, hooks receive the live
 * instance (not the wrapped derivation scope), so `.use()` on fields
 * returns the React-hook `[value, setter]` tuple and `.set()` is
 * available.
 *
 * @typeParam Def - the field-only definition record (no derivations).
 */
export interface LifecycleHookContext<Def extends Record<string, unknown>> {
	scope: HookScope<Def>;
}

/**
 * The shape of `scope` inside a lifecycle hook.
 *
 * - When `Def` is the default loose `Record<string, unknown>` (used by
 *   middleware that doesn't know the concrete shape), this resolves to
 *   `GenericScopeInstance` so middleware can read `$`-methods and
 *   freely attach new properties via assignment.
 * - When `Def` is a specific definition (the user's `valueScope` call),
 *   this resolves to `ScopeInstance<Def>` so reads and writes are
 *   strictly typed.
 *
 * @internal
 */
export type HookScope<Def extends Record<string, unknown>> =
	Record<string, unknown> extends Def ? GenericScopeInstance
	:	ScopeInstance<Def>;

// ── $ methods ────────────────────────────────────────────────────────

/**
 * The `$`-prefixed methods attached to every scope instance.
 *
 * @typeParam Def - the raw scope definition record.
 */
export interface ScopeDollarMethods<Def extends Record<string, unknown>> {
	$destroy: () => void;
	$getSnapshot: () => SnapshotOf<Def>;
	$setSnapshot: (
		data: Partial<ValueInputOf<Def>>,
		options?: { recreate?: boolean },
	) => void;
	$subscribe: (fn: () => void) => Unsubscribe;
	$use: () => [SnapshotOf<Def>, (data: Partial<ValueInputOf<Def>>) => void];
	$recompute: () => void;
	$flush: () => Promise<void>;
	$get: () => SnapshotOf<Def>;
	$getIsValid: (options?: { deep?: boolean }) => boolean;
	$useIsValid: (options?: { deep?: boolean }) => boolean;
	$getValidation: (options?: { deep?: boolean }) => ScopeValidationResult;
	$useValidation: (options?: { deep?: boolean }) => ScopeValidationResult;
}

/**
 * Aggregated validation result for a scope instance, surfaced by
 * `$getValidation()` and `$useValidation()`. Issues use scope-relative
 * `path` values; in deep mode, paths are prefixed with the route through
 * ref fields and ScopeMap entry keys.
 */
export interface ScopeValidationResult {
	readonly isValid: boolean;
	readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}

/**
 * The `$`-prefixed methods on a generic scope instance, with weakly-typed
 * snapshot shape. Middleware and lifecycle hooks see this form so they can
 * operate without knowing the specific `Def`.
 */
export interface GenericScopeInstance extends Record<string, unknown> {
	$destroy: () => void;
	$getSnapshot: () => Record<string, unknown>;
	$setSnapshot: (
		data: Record<string, unknown>,
		options?: { recreate?: boolean },
	) => void;
	$subscribe: (fn: () => void) => Unsubscribe;
	$use: () => [
		Record<string, unknown>,
		(data: Record<string, unknown>) => void,
	];
	$recompute: () => void;
	$flush: () => Promise<void>;
	$get: () => Record<string, unknown>;
}

/**
 * Full scope instance type: mapped definition fields plus `$`-prefixed methods.
 *
 * @typeParam Def - the raw scope definition record.
 */
export type ScopeInstance<Def extends Record<string, unknown>> = Simplify<
	MapDefinition<Def> & ScopeDollarMethods<Def>
>;

// ── Input types ──────────────────────────────────────────────────────

/**
 * Keys that can accept input: `value()` fields, async derivation seeds, or groups.
 * Sync derivations are excluded since they are read-only.
 * @internal
 */
type SettableKeys<Def> = {
	[K in keyof Def]: Def[K] extends ValueSchema<any, any> ? K
	: Def[K] extends Value<any, any> ? K
	: Def[K] extends ValuePlain<any, true> ? never
	: Def[K] extends ValuePlain<any, boolean> ? K
	: Def[K] extends (...args: any[]) => Promise<any> ? K
	: IsGroup<Def[K]> extends true ? K
	: never;
}[keyof Def];

/**
 * Input accepted by {@link ScopeTemplate.create | create()} and `$setSnapshot()`.
 * Includes value fields, async derivation seeds, and group objects. All keys are optional.
 *
 * @typeParam Def - the raw scope definition record.
 */
export type ValueInputOf<Def> = {
	[K in SettableKeys<Def>]?: Def[K] extends ValueSchema<infer In, any> ? In
	: Def[K] extends Value<infer In, any> ? In
	: Def[K] extends ValuePlain<infer V, boolean> ? V
	: Def[K] extends (...args: any[]) => Promise<infer A> ? Exclude<A, void>
	: Def[K] extends Record<string, unknown> ? ValueInputOf<Def[K]>
	: never;
};

// ── Snapshot type ────────────────────────────────────────────────────

/**
 * Plain-object snapshot of all reactive fields, returned by `$getSnapshot()` and `$get()`.
 *
 * @typeParam Def - the raw scope definition record.
 */
export type SnapshotOf<Def> = {
	[K in keyof Def]: Def[K] extends ValueSchema<infer In, any> ? In
	: Def[K] extends Value<any, infer Out> ? Out
	: Def[K] extends ValuePlain<infer V, any> ? V
	: Def[K] extends (...args: any[]) => Promise<infer A> ?
		Exclude<A, void> | undefined
	: Def[K] extends (...args: any[]) => infer R ? R
	: Def[K] extends Record<string, unknown> ? SnapshotOf<Def[K]>
	: Def[K];
};
