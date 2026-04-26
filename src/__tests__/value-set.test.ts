import { describe, it, expect, vi } from 'vitest';
import { valueSet } from '../index.js';

describe('ValueSet', () => {
	describe('creation', () => {
		it('creates an empty set', () => {
			const set = valueSet<string>();
			expect(set.size).toBe(0);
		});

		it('creates from initial values', () => {
			const set = valueSet([1, 2, 3]);
			expect(set.size).toBe(3);
			expect(set.has(2)).toBe(true);
		});
	});

	describe('set()', () => {
		it('replaces the entire set', () => {
			const set = valueSet([1, 2]);
			set.set(new Set([3, 4]));
			expect(set.has(1)).toBe(false);
			expect(set.has(3)).toBe(true);
		});

		it('mutates via draft callback', () => {
			const set = valueSet([1, 2, 3]);
			set.set((draft) => {
				draft.delete(2);
				draft.add(4);
			});
			expect(set.has(2)).toBe(false);
			expect(set.has(4)).toBe(true);
		});
	});

	describe('subscribe()', () => {
		it('fires on changes', () => {
			const set = valueSet([1]);
			const fn = vi.fn();
			set.subscribe(fn);
			set.set(new Set([1, 2]));
			expect(fn).toHaveBeenCalledOnce();
		});

		it('unsubscribe stops notifications', () => {
			const set = valueSet<number>();
			const fn = vi.fn();
			const unsub = set.subscribe(fn);
			unsub();
			set.set(new Set([1]));
			expect(fn).not.toHaveBeenCalled();
		});
	});

	describe('use() outside React', () => {
		it('returns [set, setter]', () => {
			const set = valueSet([1, 2]);
			const result = set.use();
			expect(result).toHaveLength(2);
			expect(result[0]).toBeInstanceOf(Set);
			expect(typeof result[1]).toBe('function');
		});

		it('setter from use() updates the set', () => {
			const set = valueSet<number>();
			const [, setter] = set.use();
			setter(new Set([1, 2, 3]));
			expect(set.size).toBe(3);
		});
	});

	describe('destroy()', () => {
		it('stops all subscribers', () => {
			const set = valueSet<number>();
			const fn = vi.fn();
			set.subscribe(fn);
			set.destroy();
			set.set(new Set([1]));
			expect(fn).not.toHaveBeenCalled();
		});
	});
});
