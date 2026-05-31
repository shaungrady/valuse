/**
 * Type-level tests for IsGroup<T>.
 *
 * @see docs/proposals/variadic-scope-api.md (validation #60)
 *
 * IsGroup distinguishes plain-object subtrees from reactive primitives.
 * Reactive collections (ValueArray, ValueMap, ValueSet) MUST be
 * excluded so DeepMerge doesn't misclassify them as subtrees and
 * recursively walk their methods.
 *
 * The audit noted in the proposal: `IsGroup` is missing three branches
 * today (ValueArray, ValueMap, ValueSet). These tests will be RED
 * until those branches land in scope-types.ts.
 */

import { expectTypeOf } from 'expect-type';
import { Value } from '../../core/value.js';
import { ValueRef } from '../../core/value-ref.js';
import { ValueSchema } from '../../core/value-schema.js';
import { ValuePlain } from '../../core/value-plain.js';
import { ValueArray } from '../../core/value-array.js';
import { ValueMap } from '../../core/value-map.js';
import { ValueSet } from '../../core/value-set.js';
import type { IsGroup } from '../../core/scope-types.js';

// ── Reactive primitives must NOT be classified as groups ────────────

expectTypeOf<IsGroup<Value<string, string>>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<ValueRef<unknown>>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<ValueSchema<string, string>>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<ValuePlain<unknown, boolean>>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<ValueArray<string, string>>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<ValueMap<string, number>>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<ValueSet<string>>>().toEqualTypeOf<false>();

// ── Functions are not groups ────────────────────────────────────────

expectTypeOf<
	IsGroup<(ctx: { scope: unknown }) => string>
>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<() => Promise<number>>>().toEqualTypeOf<false>();

// ── Plain objects ARE groups (no reactive brand, no call signature) ──

expectTypeOf<
	IsGroup<{ title: Value<string, string>; salary: Value<number, number> }>
>().toEqualTypeOf<true>();
expectTypeOf<IsGroup<{}>>().toEqualTypeOf<true>();
expectTypeOf<IsGroup<Record<string, unknown>>>().toEqualTypeOf<true>();

// ── Primitives are not groups ───────────────────────────────────────

expectTypeOf<IsGroup<string>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<number>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<boolean>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<undefined>>().toEqualTypeOf<false>();
expectTypeOf<IsGroup<null>>().toEqualTypeOf<false>();
