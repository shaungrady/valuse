import { expectTypeOf } from 'expect-type';
import { valueArray, ValueArray } from '../../core/value-array.js';
import type { Unsubscribe } from '../../core/types.js';

// ── Construction ────────────────────────────────────────────────────

const numbers = valueArray([1, 2, 3]);
expectTypeOf(numbers).toEqualTypeOf<ValueArray<number>>();

const strings = valueArray(['a', 'b']);
expectTypeOf(strings).toEqualTypeOf<ValueArray<string>>();

const empty = valueArray<string>();
expectTypeOf(empty).toEqualTypeOf<ValueArray<string>>();

// ── get() ───────────────────────────────────────────────────────────

expectTypeOf(numbers.get()).toEqualTypeOf<readonly number[]>();
expectTypeOf(numbers.get(0)).toEqualTypeOf<number | undefined>();

// ── set() ───────────────────────────────────────────────────────────

numbers.set([4, 5, 6]);
numbers.set(0, 42);

// @ts-expect-error — wrong element type
numbers.set(['a']);
// @ts-expect-error — wrong element type
numbers.set(0, 'a');

// ── Mutators ────────────────────────────────────────────────────────

numbers.push(7);
numbers.splice(0, 1);
numbers.filter((n) => {
	expectTypeOf(n).toEqualTypeOf<number>();
	return n > 0;
});

// ── subscribe ───────────────────────────────────────────────────────

const unsub = numbers.subscribe(() => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();

// ── length ──────────────────────────────────────────────────────────

expectTypeOf(numbers.length).toEqualTypeOf<number>();
