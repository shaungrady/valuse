/**
 * Type-level tests for DeepMerge<A, B>.
 *
 * @see docs/extending.md
 *
 * DeepMerge is the type-level layer accumulator: each successive
 * derivation layer deep-merges into the accumulated Def. Plain-object
 * subtrees recurse; reactive leaves and functions are leaves that
 * follow shallow-override semantics (B replaces A).
 */

import { expectTypeOf } from 'expect-type';
import type { Value } from '../../core/value.js';
import type { ValueRef } from '../../core/value-ref.js';
import type { DeepMerge } from '../../core/scope-types.js';

// ── Leaf-only merge: B wins on collision ────────────────────────────

type F1 = DeepMerge<{ a: Value<string, string> }, { a: Value<number, number> }>;
expectTypeOf<F1>().toMatchTypeOf<{ a: Value<number, number> }>();

// ── Disjoint keys: both sides retained ──────────────────────────────

type F2 = DeepMerge<
	{ a: Value<string, string> },
	{ b: (ctx: { scope: unknown }) => string }
>;
expectTypeOf<F2>().toHaveProperty('a');
expectTypeOf<F2>().toHaveProperty('b');

// ── Nested object subtrees recurse ──────────────────────────────────

type F3 = DeepMerge<
	{ outer: { inner1: Value<string, string> } },
	{ outer: { inner2: Value<number, number> } }
>;
expectTypeOf<F3['outer']>().toHaveProperty('inner1');
expectTypeOf<F3['outer']>().toHaveProperty('inner2');
expectTypeOf<F3['outer']['inner1']>().toEqualTypeOf<Value<string, string>>();
expectTypeOf<F3['outer']['inner2']>().toEqualTypeOf<Value<number, number>>();

// ── Override at a nested leaf: B wins ───────────────────────────────

type F4 = DeepMerge<
	{ outer: { shared: Value<string, string> } },
	{ outer: { shared: Value<number, number> } }
>;
expectTypeOf<F4['outer']['shared']>().toEqualTypeOf<Value<number, number>>();

// ── Subtree-on-A vs leaf-on-B: B wins (subtree replaced wholesale) ──

type F5 = DeepMerge<
	{ outer: { inner: Value<string, string> } },
	{ outer: Value<boolean, boolean> }
>;
expectTypeOf<F5['outer']>().toEqualTypeOf<Value<boolean, boolean>>();

// ── Leaf-on-A vs subtree-on-B: B wins (turns into a subtree) ────────

type F6 = DeepMerge<
	{ key: Value<string, string> },
	{ key: { nested: Value<number, number> } }
>;
expectTypeOf<F6['key']>().toMatchTypeOf<{
	nested: Value<number, number>;
}>();

// ── Function leaves override each other (no merge of bodies) ────────

type F7 = DeepMerge<
	{ a: (ctx: { scope: unknown }) => string },
	{ a: (ctx: { scope: unknown }) => number }
>;
// `a` is the B function, returning number
type F7AReturn = ReturnType<F7['a']>;
expectTypeOf<F7AReturn>().toEqualTypeOf<number>();

// ── ValueRef leaves follow shallow-override ─────────────────────────

type F8 = DeepMerge<
	{ r: ValueRef<{ x: number }> },
	{ r: ValueRef<{ y: string }> }
>;
expectTypeOf<F8['r']>().toEqualTypeOf<ValueRef<{ y: string }>>();

// ── 3-deep nesting recurses ─────────────────────────────────────────

type F9 = DeepMerge<
	{ a: { b: { c: Value<string, string> } } },
	{ a: { b: { d: Value<number, number> } } }
>;
expectTypeOf<F9['a']['b']>().toHaveProperty('c');
expectTypeOf<F9['a']['b']>().toHaveProperty('d');

// ── Realistic accumulation: fields → first deriv layer ──────────────

type Fields = {
	firstName: Value<string, string>;
	lastName: Value<string, string>;
};
type Derivs = {
	fullName: (ctx: { scope: unknown }) => string;
};
type FinalDef = DeepMerge<Fields, Derivs>;

expectTypeOf<FinalDef>().toHaveProperty('firstName');
expectTypeOf<FinalDef>().toHaveProperty('lastName');
expectTypeOf<FinalDef>().toHaveProperty('fullName');
expectTypeOf<FinalDef['fullName']>().toBeFunction();
