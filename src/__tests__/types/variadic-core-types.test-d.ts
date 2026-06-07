/**
 * Type-level tests for the variadic-scope core types.
 *
 * @see docs/extending.md
 *
 * Pins the contract for the foundational types the overloads use.
 *
 * - DerivLeaf<T>      — wraps a field type as { get, use } for derivation reads
 * - DerivScope<Def>   — maps a definition to its derivation-scope shape
 * - DerivCtx<Prior>   — unified context object (sync + async use the same ctx)
 * - FieldLayer<L>     — slot constraint that rejects functions
 */

import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import { valueRef } from '../../core/value-ref.js';
import { valueSchema } from '../../core/value-schema.js';
import { valuePlain } from '../../core/value-plain.js';
import { valueArray } from '../../core/value-array.js';
import { valueMap } from '../../core/value-map.js';
import { valueSet } from '../../core/value-set.js';
import { type } from 'arktype';
import type {
	DerivLeaf,
	DerivScope,
	DerivCtx,
	FieldLayer,
} from '../../core/scope-types.js';

// ── DerivLeaf: each field type maps to its { get, use } wrapper ─────

const stringValue = value<string>();
type StringValueLeaf = DerivLeaf<typeof stringValue>;
expectTypeOf<StringValueLeaf>().toMatchTypeOf<{
	get(): string | undefined;
	use(): string | undefined;
}>();

const numberValueWithDefault = value(42);
type NumberValueLeaf = DerivLeaf<typeof numberValueWithDefault>;
expectTypeOf<NumberValueLeaf>().toMatchTypeOf<{
	get(): number;
	use(): number;
}>();

const refToValue = valueRef(value<boolean>(false));
type ValueRefLeaf = DerivLeaf<typeof refToValue>;
expectTypeOf<ValueRefLeaf['use']>().toBeFunction();
// `.use()` on a ref hands back the resolved source value (a boolean here)
expectTypeOf<ValueRefLeaf>().toHaveProperty('get');

const Email = type('string.email');
const emailSchema = valueSchema(Email, '');
type SchemaLeaf = DerivLeaf<typeof emailSchema>;
expectTypeOf<SchemaLeaf>().toHaveProperty('get');
expectTypeOf<SchemaLeaf>().toHaveProperty('use');

const arr = valueArray<string>();
type ArrayLeaf = DerivLeaf<typeof arr>;
expectTypeOf<ArrayLeaf>().toHaveProperty('get');
expectTypeOf<ArrayLeaf>().toHaveProperty('use');

const map = valueMap<string, number>();
type MapLeaf = DerivLeaf<typeof map>;
expectTypeOf<MapLeaf>().toHaveProperty('get');
expectTypeOf<MapLeaf>().toHaveProperty('use');

const set = valueSet<string>();
type SetLeaf = DerivLeaf<typeof set>;
expectTypeOf<SetLeaf>().toHaveProperty('get');
expectTypeOf<SetLeaf>().toHaveProperty('use');

const plain = valuePlain({ x: 1 });
type PlainLeaf = DerivLeaf<typeof plain>;
expectTypeOf<PlainLeaf>().toHaveProperty('get');

// Sync function derivation — returns its return type directly
type SyncFn = (ctx: { scope: unknown }) => number;
type SyncFnLeaf = DerivLeaf<SyncFn>;
expectTypeOf<SyncFnLeaf>().toMatchTypeOf<{
	get(): number;
	use(): number;
}>();

// Async function derivation — returns the unwrapped Promise type | undefined
type AsyncFn = (ctx: { scope: unknown }) => Promise<{ name: string }>;
type AsyncFnLeaf = DerivLeaf<AsyncFn>;
expectTypeOf<AsyncFnLeaf>().toMatchTypeOf<{
	get(): { name: string } | undefined;
	use(): { name: string } | undefined;
}>();

// ── DerivScope: mapped over a definition ────────────────────────────

type Fields = {
	firstName: ReturnType<typeof value<string>>;
	age: ReturnType<typeof value<number>>;
};
type Scope = DerivScope<Fields>;

expectTypeOf<Scope>().toHaveProperty('firstName');
expectTypeOf<Scope>().toHaveProperty('age');
expectTypeOf<Scope['firstName']['use']>().toBeFunction();
expectTypeOf<Scope['age']['use']>().toBeFunction();

// Nested objects recurse
type NestedFields = {
	name: ReturnType<typeof value<string>>;
	job: {
		title: ReturnType<typeof value<string>>;
	};
};
type NestedScope = DerivScope<NestedFields>;
expectTypeOf<NestedScope['job']>().toHaveProperty('title');
expectTypeOf<NestedScope['job']['title']['use']>().toBeFunction();

// ── DerivCtx: unified shape for sync AND async derivations ──────────

type Ctx = DerivCtx<Fields>;

expectTypeOf<Ctx>().toMatchTypeOf<{
	scope: DerivScope<Fields>;
	signal: AbortSignal;
	set: (value: unknown) => void;
	onCleanup: (fn: () => void) => void;
	previousValue: unknown;
}>();

// `scope` is required and concrete; `set`/`signal`/`onCleanup`/`previousValue`
// are always present (Option A; see proposal).
expectTypeOf<Ctx['scope']>().toEqualTypeOf<DerivScope<Fields>>();
expectTypeOf<Ctx['signal']>().toEqualTypeOf<AbortSignal>();

// ── FieldLayer: rejects function entries (functions → never) ────────

type FunctionInLayer = {
	greeting: (ctx: { scope: unknown }) => string;
};
type RejectedFnLayer = FieldLayer<FunctionInLayer>;
// The function entry collapses to `never`, so the intersected
// `L & FieldLayer<L>` constraint fails to match a real function.
expectTypeOf<RejectedFnLayer['greeting']>().toBeNever();

type AllValid = {
	a: ReturnType<typeof value<string>>;
	b: ReturnType<typeof valueSet<string>>;
	c: { nested: ReturnType<typeof value<number>> };
	d: 42; // static data
};
type AllValidLayer = FieldLayer<AllValid>;
expectTypeOf<AllValidLayer['a']>().not.toBeNever();
expectTypeOf<AllValidLayer['b']>().not.toBeNever();
expectTypeOf<AllValidLayer['c']>().not.toBeNever();
expectTypeOf<AllValidLayer['d']>().not.toBeNever();
