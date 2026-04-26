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
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * `true` when `T` is a plain-object group (not a `Value`, not a function).
 * @internal
 */
type IsGroup<T> =
	T extends Value<any, any> ? false
	: T extends ValueSchema<any, any> ? false
	: T extends ValuePlain<any, any> ? false
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
