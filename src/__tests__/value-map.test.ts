import { describe, it, expect } from 'vitest';
import { valueMap } from '../index.js';

describe('valueMap', () => {
	describe('creation', () => {
		it('creates an empty map', () => {
			const m = valueMap<string, number>();
			expect(m.get()).toEqual(new Map());
		});

		it('creates a map from initial entries', () => {
			const m = valueMap<string, number>([
				['alice', 95],
				['bob', 82],
			]);
			expect(m.get()).toEqual(
				new Map([
					['alice', 95],
					['bob', 82],
				]),
			);
		});

		it('creates from an existing Map instance (cloned)', () => {
			const source = new Map([['alice', 95]]);
			const m = valueMap<string, number>(source);
			expect(m.get()).toEqual(source);
			expect(m.get()).not.toBe(source);
		});
	});

	describe('.get(key)', () => {
		it('returns value for existing key', () => {
			const m = valueMap<string, number>([['alice', 95]]);
			expect(m.get('alice')).toBe(95);
		});

		it('returns undefined for missing key', () => {
			const m = valueMap<string, number>();
			expect(m.get('alice')).toBeUndefined();
		});
	});

	describe('.set()', () => {
		it('replaces the entire map', () => {
			const m = valueMap<string, number>([['a', 1]]);
			m.set(new Map([['b', 2]]));
			expect(m.get()).toEqual(new Map([['b', 2]]));
		});

		it('mutates via draft callback — set', () => {
			const m = valueMap<string, number>();
			m.set((draft) => {
				draft.set('alice', 95);
			});
			expect(m.get('alice')).toBe(95);
		});

		it('mutates via draft callback — delete', () => {
			const m = valueMap<string, number>([
				['alice', 95],
				['bob', 82],
			]);
			m.set((draft) => {
				draft.delete('alice');
			});
			expect(m.get()).toEqual(new Map([['bob', 82]]));
		});

		it('produces a new Map instance on draft mutation', () => {
			const m = valueMap<string, number>([['a', 1]]);
			const before = m.get();
			m.set((draft) => {
				draft.set('b', 2);
			});
			expect(before).not.toBe(m.get());
		});

		it('returns same Map instance if draft has no changes', () => {
			const m = valueMap<string, number>([['a', 1]]);
			const before = m.get();
			m.set((_draft) => {
				// no changes
			});
			expect(before).toBe(m.get());
		});
	});

	describe('.delete()', () => {
		it('deletes a key and returns true', () => {
			const m = valueMap<string, number>([['a', 1]]);
			expect(m.delete('a')).toBe(true);
			expect(m.get()).toEqual(new Map());
		});

		it('returns false for missing key', () => {
			const m = valueMap<string, number>();
			expect(m.delete('a')).toBe(false);
		});
	});

	describe('Map-like methods', () => {
		it('.size returns entry count', () => {
			const m = valueMap<string, number>([
				['a', 1],
				['b', 2],
			]);
			expect(m.size).toBe(2);
		});

		it('.has() checks key existence', () => {
			const m = valueMap<string, number>([['a', 1]]);
			expect(m.has('a')).toBe(true);
			expect(m.has('b')).toBe(false);
		});

		it('.keys() returns array of keys', () => {
			const m = valueMap<string, number>([
				['a', 1],
				['b', 2],
			]);
			expect(m.keys()).toEqual(['a', 'b']);
		});

		it('.values() returns array of values', () => {
			const m = valueMap<string, number>([
				['a', 1],
				['b', 2],
			]);
			expect(m.values()).toEqual([1, 2]);
		});

		it('.entries() returns array of entries', () => {
			const m = valueMap<string, number>([
				['a', 1],
				['b', 2],
			]);
			expect(m.entries()).toEqual([
				['a', 1],
				['b', 2],
			]);
		});

		it('.clear() removes all entries', () => {
			const m = valueMap<string, number>([
				['a', 1],
				['b', 2],
			]);
			m.clear();
			expect(m.get()).toEqual(new Map());
		});
	});

	describe('.subscribe()', () => {
		it('notifies on change', () => {
			const m = valueMap<string, number>();
			const calls: Map<string, number>[] = [];
			m.subscribe((val) => calls.push(val));
			m.set((draft) => {
				draft.set('a', 1);
			});
			expect(calls).toHaveLength(1);
		});

		it('does not notify when draft has no changes', () => {
			const m = valueMap<string, number>([['a', 1]]);
			const calls: Map<string, number>[] = [];
			m.subscribe((val) => calls.push(val));
			m.set((_draft) => {
				// no changes
			});
			expect(calls).toHaveLength(0);
		});

		it('returns unsubscribe', () => {
			const m = valueMap<string, number>();
			const calls: Map<string, number>[] = [];
			const unsub = m.subscribe((val) => calls.push(val));
			unsub();
			m.set((draft) => {
				draft.set('a', 1);
			});
			expect(calls).toHaveLength(0);
		});
	});

	describe('.pipe()', () => {
		it('transforms on set', () => {
			const m = valueMap<string, number>().pipe(
				(map) => new Map([...map].map(([k, v]) => [k, Math.max(0, v)])),
			);
			m.set(
				new Map([
					['a', -5],
					['b', 10],
				]),
			);
			expect(m.get()).toEqual(
				new Map([
					['a', 0],
					['b', 10],
				]),
			);
		});
	});

	describe('.compareUsing()', () => {
		it('suppresses notification when comparator returns true', () => {
			const m = valueMap<string, number>([['a', 1]]).compareUsing(
				(a, b) => a.size === b.size,
			);
			const calls: Map<string, number>[] = [];
			m.subscribe((val) => calls.push(val));
			m.set(new Map([['b', 2]])); // same size
			expect(calls).toHaveLength(0);
		});
	});
});
