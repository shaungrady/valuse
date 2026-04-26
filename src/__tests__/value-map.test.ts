import { describe, it, expect, vi } from 'vitest';
import { valueMap } from '../index.js';

describe('ValueMap', () => {
	describe('creation', () => {
		it('creates an empty map', () => {
			const map = valueMap<string, number>();
			expect(map.size).toBe(0);
			expect(map.get()).toEqual(new Map());
		});

		it('creates from entries', () => {
			const map = valueMap([
				['a', 1],
				['b', 2],
			] as [string, number][]);
			expect(map.size).toBe(2);
			expect(map.get('a')).toBe(1);
		});
	});

	describe('get()', () => {
		it('returns the whole map with no args', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			const result = map.get();
			expect(result).toBeInstanceOf(Map);
			expect(result.size).toBe(1);
		});

		it('returns a single value by key', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			expect(map.get('a')).toBe(1);
		});

		it('returns undefined for missing key', () => {
			const map = valueMap<string, number>();
			expect(map.get('x')).toBeUndefined();
		});
	});

	describe('set()', () => {
		it('replaces the entire map', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			map.set(
				new Map([
					['x', 10],
					['y', 20],
				]),
			);
			expect(map.get('x')).toBe(10);
			expect(map.get('a')).toBeUndefined();
		});

		it('mutates via draft callback', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			map.set((draft) => {
				draft.set('b', 2);
				draft.delete('a');
			});
			expect(map.has('a')).toBe(false);
			expect(map.get('b')).toBe(2);
		});
	});

	describe('delete()', () => {
		it('removes an existing key', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			const result = map.delete('a');
			expect(result).toBe(true);
			expect(map.size).toBe(0);
		});

		it('returns false for missing key', () => {
			const map = valueMap<string, number>();
			expect(map.delete('x')).toBe(false);
		});
	});

	describe('has()', () => {
		it('returns true for existing key', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			expect(map.has('a')).toBe(true);
		});

		it('returns false for missing key', () => {
			const map = valueMap<string, number>();
			expect(map.has('x')).toBe(false);
		});
	});

	describe('keys/values/entries', () => {
		it('returns keys', () => {
			const map = valueMap([
				['a', 1],
				['b', 2],
			] as [string, number][]);
			expect(map.keys()).toEqual(['a', 'b']);
		});

		it('returns values', () => {
			const map = valueMap([
				['a', 1],
				['b', 2],
			] as [string, number][]);
			expect(map.values()).toEqual([1, 2]);
		});

		it('returns entries', () => {
			const map = valueMap([
				['a', 1],
				['b', 2],
			] as [string, number][]);
			expect(map.entries()).toEqual([
				['a', 1],
				['b', 2],
			]);
		});
	});

	describe('clear()', () => {
		it('removes all entries', () => {
			const map = valueMap([
				['a', 1],
				['b', 2],
			] as [string, number][]);
			map.clear();
			expect(map.size).toBe(0);
		});
	});

	describe('subscribe()', () => {
		it('fires on changes with current and previous', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			const calls: [Map<string, number>, Map<string, number>][] = [];
			map.subscribe((current, previous) => calls.push([current, previous]));
			map.set((draft) => draft.set('b', 2));
			expect(calls).toHaveLength(1);
			expect(calls[0]![0].has('b')).toBe(true);
			expect(calls[0]![1].has('b')).toBe(false);
		});

		it('unsubscribe stops notifications', () => {
			const map = valueMap<string, number>();
			const fn = vi.fn();
			const unsub = map.subscribe(fn);
			unsub();
			map.set(new Map([['a', 1]]));
			expect(fn).not.toHaveBeenCalled();
		});
	});

	describe('pipe()', () => {
		it('transforms values on set', () => {
			const map = valueMap<string, number>().pipe((m) => {
				// Only keep entries with value > 0
				const filtered = new Map<string, number>();
				for (const [k, v] of m) {
					if (v > 0) filtered.set(k, v);
				}
				return filtered;
			});
			map.set(
				new Map([
					['a', 1],
					['b', -1],
					['c', 3],
				]),
			);
			expect(map.size).toBe(2);
			expect(map.has('b')).toBe(false);
		});
	});

	describe('compareUsing()', () => {
		it('suppresses updates when comparator returns true', () => {
			const map = valueMap([['a', 1]] as [string, number][]).compareUsing(
				(a, b) => a.size === b.size,
			);
			const fn = vi.fn();
			map.subscribe(fn);
			// Same size map
			map.set(new Map([['x', 99]]));
			expect(fn).not.toHaveBeenCalled();
		});
	});

	describe('use() outside React', () => {
		it('returns [map, setter] for whole map', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			const result = map.use();
			expect(result).toHaveLength(2);
			expect(result[0]).toBeInstanceOf(Map);
			expect(typeof result[1]).toBe('function');
		});

		it('setter from use() updates the map', () => {
			const map = valueMap<string, number>();
			const [, setter] = map.use();
			setter(new Map([['a', 1]]));
			expect(map.get('a')).toBe(1);
		});

		it('returns [value, setter] for per-key use', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			const result = map.use('a');
			expect(result).toHaveLength(2);
			expect(result[0]).toBe(1);
			expect(typeof result[1]).toBe('function');
		});

		it('per-key setter updates the specific key', () => {
			const map = valueMap([['a', 1]] as [string, number][]);
			const [, setter] = map.use('a');
			setter(10);
			expect(map.get('a')).toBe(10);
		});
	});

	describe('destroy()', () => {
		it('stops all subscribers', () => {
			const map = valueMap<string, number>();
			const fn = vi.fn();
			map.subscribe(fn);
			map.destroy();
			map.set(new Map([['a', 1]]));
			expect(fn).not.toHaveBeenCalled();
		});
	});
});
