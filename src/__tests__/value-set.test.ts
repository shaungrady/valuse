import { describe, it, expect } from 'vitest';
import { valueSet } from '../index.js';

describe('valueSet', () => {
	describe('creation', () => {
		it('creates an empty set with no arguments', () => {
			const s = valueSet<string>();
			expect(s.get()).toEqual(new Set());
		});

		it('creates a set from an initial array', () => {
			const s = valueSet<string>(['admin', 'active']);
			expect(s.get()).toEqual(new Set(['admin', 'active']));
		});

		it('creates from an existing Set instance (cloned)', () => {
			const source = new Set(['x', 'y']);
			const s = valueSet<string>(source);
			expect(s.get()).toEqual(source);
			expect(s.get()).not.toBe(source);
		});
	});

	describe('.set()', () => {
		it('replaces the entire set', () => {
			const s = valueSet<string>(['a', 'b']);
			s.set(new Set(['c', 'd']));
			expect(s.get()).toEqual(new Set(['c', 'd']));
		});

		it('mutates via draft callback — add', () => {
			const s = valueSet<string>(['a']);
			s.set((draft) => {
				draft.add('b');
			});
			expect(s.get()).toEqual(new Set(['a', 'b']));
		});

		it('mutates via draft callback — delete', () => {
			const s = valueSet<string>(['a', 'b']);
			s.set((draft) => {
				draft.delete('a');
			});
			expect(s.get()).toEqual(new Set(['b']));
		});

		it('produces a new Set instance on draft mutation', () => {
			const s = valueSet<string>(['a']);
			const before = s.get();
			s.set((draft) => {
				draft.add('b');
			});
			const after = s.get();
			expect(before).not.toBe(after);
		});

		it('returns same Set instance if draft has no changes', () => {
			const s = valueSet<string>(['a']);
			const before = s.get();
			s.set((draft) => {
				draft.add('a'); // already exists
			});
			const after = s.get();
			expect(before).toBe(after);
		});
	});

	describe('.subscribe()', () => {
		it('notifies on change', () => {
			const s = valueSet<string>(['a']);
			const calls: Set<string>[] = [];
			s.subscribe((val) => calls.push(val));
			s.set((draft) => {
				draft.add('b');
			});
			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual(new Set(['a', 'b']));
		});

		it('does not notify when draft has no changes', () => {
			const s = valueSet<string>(['a']);
			const calls: Set<string>[] = [];
			s.subscribe((val) => calls.push(val));
			s.set((draft) => {
				draft.add('a');
			});
			expect(calls).toHaveLength(0);
		});

		it('returns unsubscribe function', () => {
			const s = valueSet<string>();
			const calls: Set<string>[] = [];
			const unsub = s.subscribe((val) => calls.push(val));
			unsub();
			s.set(new Set(['x']));
			expect(calls).toHaveLength(0);
		});
	});

	describe('.pipe()', () => {
		it('transforms on set', () => {
			const s = valueSet<string>().pipe(
				(set) => new Set([...set].map((t) => t.toLowerCase())),
			);
			s.set(new Set(['HELLO', 'WORLD']));
			expect(s.get()).toEqual(new Set(['hello', 'world']));
		});

		it('chains multiple pipes', () => {
			const s = valueSet<string>()
				.pipe((set) => new Set([...set].map((t) => t.trim())))
				.pipe((set) => new Set([...set].map((t) => t.toLowerCase())));
			s.set(new Set(['  HELLO  ']));
			expect(s.get()).toEqual(new Set(['hello']));
		});
	});

	describe('.compareUsing()', () => {
		it('suppresses notification when comparator returns true', () => {
			const s = valueSet<string>(['a']).compareUsing(
				(a, b) => a.size === b.size,
			);
			const calls: Set<string>[] = [];
			s.subscribe((val) => calls.push(val));
			s.set(new Set(['x'])); // same size
			expect(calls).toHaveLength(0);
		});

		it('allows notification when comparator returns false', () => {
			const s = valueSet<string>(['a']).compareUsing(
				(a, b) => a.size === b.size,
			);
			const calls: Set<string>[] = [];
			s.subscribe((val) => calls.push(val));
			s.set(new Set(['x', 'y'])); // different size
			expect(calls).toHaveLength(1);
		});
	});

	describe('collection methods', () => {
		it('.has() checks membership', () => {
			const s = valueSet(['a', 'b']);
			expect(s.has('a')).toBe(true);
			expect(s.has('c')).toBe(false);
		});

		it('.size returns element count', () => {
			const s = valueSet(['a', 'b', 'c']);
			expect(s.size).toBe(3);
		});

		it('.values() returns array', () => {
			const s = valueSet(['a', 'b']);
			expect(s.values()).toEqual(['a', 'b']);
		});

		it('.clear() empties the set', () => {
			const s = valueSet(['a', 'b']);
			s.clear();
			expect(s.size).toBe(0);
			expect(s.get().size).toBe(0);
		});

		it('.delete() removes an element', () => {
			const s = valueSet(['a', 'b']);
			expect(s.delete('a')).toBe(true);
			expect(s.delete('a')).toBe(false);
			expect(s.has('a')).toBe(false);
			expect(s.size).toBe(1);
		});

		it('.add() adds an element', () => {
			const s = valueSet(['a']);
			s.add('b');
			expect(s.has('b')).toBe(true);
			expect(s.size).toBe(2);
		});

		it('.add() is a no-op for existing elements', () => {
			const s = valueSet(['a']);
			const calls: unknown[] = [];
			s.subscribe(() => calls.push(true));
			s.add('a');
			expect(calls).toHaveLength(0);
		});

		it('.destroy() stops all subscribers', () => {
			const s = valueSet(['a']);
			const calls: unknown[] = [];
			s.subscribe(() => calls.push(true));
			s.set(new Set(['b']));
			expect(calls).toHaveLength(1);
			s.destroy();
			s.set(new Set(['c']));
			expect(calls).toHaveLength(1);
		});
	});
});
