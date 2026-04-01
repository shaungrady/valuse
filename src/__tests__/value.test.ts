import { describe, it, expect } from 'vitest';
import { value, batch } from '../index.js';

describe('value', () => {
	describe('creation', () => {
		it('creates a value with a default', () => {
			const v = value<string>('hello');
			expect(v.get()).toBe('hello');
		});

		it('creates a value without a default (undefined)', () => {
			const v = value<string>();
			expect(v.get()).toBeUndefined();
		});

		it('infers type from default', () => {
			const v = value(42);
			expect(v.get()).toBe(42);
		});
	});

	describe('.set()', () => {
		it('sets a direct value', () => {
			const v = value<string>('hello');
			v.set('world');
			expect(v.get()).toBe('world');
		});

		it('sets via callback', () => {
			const v = value<number>(10);
			v.set((prev) => prev + 5);
			expect(v.get()).toBe(15);
		});

		it('sets a value that was initially undefined', () => {
			const v = value<string>();
			v.set('hello');
			expect(v.get()).toBe('hello');
		});
	});

	describe('.subscribe()', () => {
		it('calls subscriber on change', () => {
			const v = value<string>('hello');
			const calls: string[] = [];
			v.subscribe((val) => calls.push(val));
			v.set('world');
			expect(calls).toContain('world');
		});

		it('returns an unsubscribe function', () => {
			const v = value<string>('hello');
			const calls: string[] = [];
			const unsub = v.subscribe((val) => calls.push(val));
			unsub();
			v.set('world');
			expect(calls).not.toContain('world');
		});
	});

	describe('.pipe()', () => {
		it('transforms values on set', () => {
			const v = value<string>('').pipe((s) => s.trim());
			v.set('  hello  ');
			expect(v.get()).toBe('hello');
		});

		it('chains multiple pipes', () => {
			const v = value<string>('')
				.pipe((s) => s.trim())
				.pipe((s) => s.toLowerCase());
			v.set('  HELLO  ');
			expect(v.get()).toBe('hello');
		});

		it('applies pipe to initial value', () => {
			const v = value<string>('  HELLO  ')
				.pipe((s) => s.trim())
				.pipe((s) => s.toLowerCase());
			expect(v.get()).toBe('hello');
		});
	});

	describe('.compareUsing()', () => {
		it('suppresses updates when comparator returns true', () => {
			const v = value<{ id: number; name: string }>({
				id: 1,
				name: 'Alice',
			}).compareUsing((a, b) => a.id === b.id);
			const calls: { id: number; name: string }[] = [];
			v.subscribe((val) => calls.push(val));
			v.set({ id: 1, name: 'Bob' }); // same id — should not notify
			expect(calls).toHaveLength(0);
		});

		it('allows updates when comparator returns false', () => {
			const v = value<{ id: number; name: string }>({
				id: 1,
				name: 'Alice',
			}).compareUsing((a, b) => a.id === b.id);
			const calls: { id: number; name: string }[] = [];
			v.subscribe((val) => calls.push(val));
			v.set({ id: 2, name: 'Bob' }); // different id — should notify
			expect(calls).toHaveLength(1);
		});

		it('chains with pipe', () => {
			const v = value<string>('')
				.pipe((s) => s.trim())
				.compareUsing((a, b) => a === b);
			const calls: string[] = [];
			v.subscribe((val) => calls.push(val));
			v.set('hello');
			v.set('  hello  '); // after trim, same as current — should not notify
			expect(calls).toHaveLength(1);
		});
	});

	describe('.destroy()', () => {
		it('stops all subscribers from firing', () => {
			const v = value(0);
			const calls: number[] = [];
			v.subscribe((val) => calls.push(val));
			v.set(1);
			expect(calls).toEqual([1]);
			v.destroy();
			v.set(2);
			expect(calls).toEqual([1]); // no new call
		});

		it('value is still readable after destroy', () => {
			const v = value(0);
			v.subscribe(() => {});
			v.destroy();
			v.set(5);
			expect(v.get()).toBe(5);
		});
	});

	describe('batch()', () => {
		it('batches multiple updates into one subscriber notification', () => {
			const a = value(0);
			const b = value(0);
			let callCount = 0;
			a.subscribe(() => callCount++);
			b.subscribe(() => callCount++);

			batch(() => {
				a.set(1);
				b.set(2);
			});

			expect(callCount).toBe(2); // each fires once, not during the batch
			expect(a.get()).toBe(1);
			expect(b.get()).toBe(2);
		});
	});
});
