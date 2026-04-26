import { expectTypeOf } from 'expect-type';
import { valueMap, ValueMap } from '../../core/value-map.js';
import type { Unsubscribe } from '../../core/types.js';

// ── Construction ────────────────────────────────────────────────────

const scores = valueMap<string, number>([['alice', 95]]);
expectTypeOf(scores).toEqualTypeOf<ValueMap<string, number>>();

const empty = valueMap<string, boolean>();
expectTypeOf(empty).toEqualTypeOf<ValueMap<string, boolean>>();

// ── get() ───────────────────────────────────────────────────────────

// Whole map
expectTypeOf(scores.get()).toEqualTypeOf<Map<string, number>>();

// Single key
expectTypeOf(scores.get('alice')).toEqualTypeOf<number | undefined>();

// ── set() ───────────────────────────────────────────────────────────

// Replace the whole map
scores.set(new Map([['bob', 100]]));

// Draft callback
scores.set((draft) => {
	expectTypeOf(draft).toEqualTypeOf<Map<string, number>>();
	draft.set('carol', 88);
});

// @ts-expect-error — wrong value type
scores.set(new Map([['bob', 'high']]));

// ── delete / has ────────────────────────────────────────────────────

expectTypeOf(scores.delete('alice')).toEqualTypeOf<boolean>();
expectTypeOf(scores.has('alice')).toEqualTypeOf<boolean>();

// ── keys / values / entries ─────────────────────────────────────────

expectTypeOf(scores.keys()).toEqualTypeOf<string[]>();

// ── subscribe ───────────────────────────────────────────────────────

const unsub = scores.subscribe(() => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();
