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

		/**
		 * Contract: a draft mutator that throws mid-way leaves the set
		 * untouched (no partial commits). The user's error propagates out
		 * of `.set()` rather than being swallowed.
		 */
		it('throwing draft mutator: no partial commits, error propagates', () => {
			const set = valueSet([1, 2]);
			const subscriber = vi.fn();
			set.subscribe(subscriber);
			expect(() =>
				set.set((draft) => {
					draft.add(99);
					draft.delete(1);
					throw new Error('mid-mutation');
				}),
			).toThrow('mid-mutation');
			expect(set.has(1)).toBe(true);
			expect(set.has(99)).toBe(false);
			expect(subscriber).not.toHaveBeenCalled();
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

		/**
		 * Bug: a throwing subscriber used to propagate out of `.set()` /
		 * mutation methods. Contract: throw is contained, siblings still
		 * fire, the write lands, subsequent writes work.
		 */
		it('a throwing subscriber does not poison .set()', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const set = valueSet<number>([1]);
			const after = vi.fn();
			set.subscribe(() => {
				throw new Error('boom');
			});
			set.subscribe(after);
			expect(() => set.set(new Set([1, 2]))).not.toThrow();
			expect(set.has(2)).toBe(true);
			expect(after).toHaveBeenCalledOnce();
			errSpy.mockRestore();
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

		it('writes after destroy are silently dropped', () => {
			const set = valueSet<number>([1]);
			set.destroy();
			set.set(new Set([99]));
			set.add(2);
			set.delete(1);
			set.clear();
			// Reads still return the last value.
			expect([...set.get()]).toEqual([1]);
		});

		it('destroy() is idempotent', () => {
			const set = valueSet<number>();
			set.subscribe(() => {});
			expect(() => {
				set.destroy();
				set.destroy();
			}).not.toThrow();
		});
	});

	/**
	 * Bug: `clear()` unconditionally assigned a fresh `new Set()` to
	 * the backing signal. When the set was already empty, that's still a new
	 * reference, so Preact fired subscribers (and React re-renders) for a
	 * state that didn't actually change. Parallel to the `valueMap.clear()`
	 * fix shipped earlier.
	 */
	describe('clear() idempotency', () => {
		it('clear() on an already-empty set does not notify subscribers', () => {
			const set = valueSet<number>();
			const subscriber = vi.fn();
			set.subscribe(subscriber);
			set.clear();
			expect(subscriber).not.toHaveBeenCalled();
		});
	});
});
