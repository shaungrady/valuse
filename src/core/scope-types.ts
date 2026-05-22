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
import type { ScopeMap } from './scope-map.js';
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
 * `true` when `T` is a plain-object group (not a `Value`, not a function).
 * @internal
 */
type IsGroup<T> =
	T extends Value<any, any> ? false
	: T extends ValueSchema<any, any> ? false
	: T extends ValuePlain<any, any> ? false
	: T extends ValueRef<any> ? false
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
 * is a `{ get, use }` wrapper — `.use()` returns the value directly
 * (NOT a `[value, setter]` tuple as on `ScopeInstance`), and is
 * tracked for re-evaluation when the field changes.
 *
 * For `valueRef(scopeMap)`, the wrapper's `.use()` / `.get()` hand back
 * the underlying `ScopeMap` (so callers reach in with `.get(key)` etc).
 * For `valueRef(scopeInstance)`, the wrapper hands back the live
 * instance. For scalar refs, the wrapper hands back the resolved value.
 *
 * @internal
 */
type DerivationLeaf<T> =
	T extends Value<any, infer Out> ? { get(): Out; use(): Out }
	: T extends ValueSchema<any, infer Out> ? { get(): Out; use(): Out }
	: T extends ValuePlain<infer V, any> ? { get(): V; use(): V }
	: T extends ValueRef<infer S> ?
		ResolvedRef<S> extends ScopeMap<any, any> ?
			{ get(): ResolvedRef<S>; use(): ResolvedRef<S> }
		:	{ get(): ResolvedRef<S>; use(): ResolvedRef<S> }
	: T extends (...args: any[]) => Promise<infer A> ?
		{
			get(): Exclude<A, void> | undefined;
			use(): Exclude<A, void> | undefined;
		}
	: T extends (...args: any[]) => infer R ? { get(): R; use(): R }
	: T;

/**
 * Map a field-only definition to its derivation-context scope shape.
 *
 * Each field becomes a `DerivationLeaf<T>` (a `{ get, use }` wrapper).
 * Nested groups recurse. This intentionally differs from
 * `ScopeInstance<Def>` because reads inside a derivation go through
 * `DerivationWrap`, which returns values directly (not React-hook
 * tuples).
 *
 * @typeParam Def - the field-only definition record.
 */
export type DerivationScope<Def extends Record<string, unknown>> = {
	readonly [K in keyof Def]: Def[K] extends Record<string, unknown> ?
		IsGroup<Def[K]> extends true ?
			Readonly<DerivationScope<Def[K]>>
		:	DerivationLeaf<Def[K]>
	:	DerivationLeaf<Def[K]>;
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
	scope: DerivationScope<Def>;
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
	scope: DerivationScope<Def>;
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

// ── Extend merging ──────────────────────────────────────────────────

/**
 * Merge a base definition with an extension.
 * Keys in Ext override Base; `undefined` values remove the key.
 */
export type ExtendDef<Base, Ext> = Simplify<
	{
		[K in Exclude<keyof Base, keyof Ext>]: Base[K];
	} & {
		[K in keyof Ext as Ext[K] extends undefined ? never : K]: Ext[K];
	}
>;
