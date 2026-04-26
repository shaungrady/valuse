import { expectTypeOf } from 'expect-type';
import { valueSet, ValueSet } from '../../core/value-set.js';
import type { Unsubscribe } from '../../core/types.js';

// ── Construction ────────────────────────────────────────────────────

const tags = valueSet(['a', 'b']);
expectTypeOf(tags).toEqualTypeOf<ValueSet<string>>();

const nums = valueSet([1, 2, 3]);
expectTypeOf(nums).toEqualTypeOf<ValueSet<number>>();

const empty = valueSet<string>();
expectTypeOf(empty).toEqualTypeOf<ValueSet<string>>();

// ── get() ───────────────────────────────────────────────────────────

expectTypeOf(tags.get()).toEqualTypeOf<Set<string>>();

// ── set() ───────────────────────────────────────────────────────────

tags.set(new Set(['c', 'd']));

// Draft callback
tags.set((draft) => {
	expectTypeOf(draft).toEqualTypeOf<Set<string>>();
	draft.add('e');
});

// @ts-expect-error — wrong type
tags.set(new Set([1, 2]));

// ── has / add / delete ──────────────────────────────────────────────

expectTypeOf(tags.has('a')).toEqualTypeOf<boolean>();
tags.add('c');
tags.delete('a');

// ── subscribe ───────────────────────────────────────────────────────

const unsub = tags.subscribe(() => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();
