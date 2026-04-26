import { describe, it, expect, vi } from 'vitest';
import { valueArray } from '../core/value-array.js';

describe('valueArray', () => {
	describe('creation and basic access', () => {
		it('creates an empty array by default', () => {
			const arr = valueArray<string>();
			expect(arr.get()).toEqual([]);
			expect(arr.length).toBe(0);
		});

		it('creates with initial values', () => {
			const arr = valueArray<string>(['Alice', 'Bob']);
			expect(arr.get()).toEqual(['Alice', 'Bob']);
			expect(arr.length).toBe(2);
		});

		it('get() returns a frozen array', () => {
			const arr = valueArray<string>(['a']);
			expect(Object.isFrozen(arr.get())).toBe(true);
		});

		it('get(index) returns element at index', () => {
			const arr = valueArray<string>(['Alice', 'Bob', 'Charlie']);
			expect(arr.get(0)).toBe('Alice');
			expect(arr.get(1)).toBe('Bob');
			expect(arr.get(2)).toBe('Charlie');
		});

		it('get(negative) returns from end', () => {
			const arr = valueArray<string>(['Alice', 'Bob', 'Charlie']);
			expect(arr.get(-1)).toBe('Charlie');
			expect(arr.get(-2)).toBe('Bob');
		});

		it('get(out of bounds) returns undefined', () => {
			const arr = valueArray<string>(['Alice']);
			expect(arr.get(99)).toBeUndefined();
		});
	});

	describe('set()', () => {
		it('set(array) replaces entire array', () => {
			const arr = valueArray<string>();
			arr.set(['Alice', 'Bob']);
			expect(arr.get()).toEqual(['Alice', 'Bob']);
		});

		it('set(index, value) replaces single element', () => {
			const arr = valueArray<string>(['Alice', 'Bob']);
			arr.set(0, 'Alicia');
			expect(arr.get()).toEqual(['Alicia', 'Bob']);
		});
	});

	describe('mutations', () => {
		it('push() appends elements', () => {
			const arr = valueArray<string>(['Alice']);
			arr.push('Bob');
			expect(arr.get()).toEqual(['Alice', 'Bob']);
			arr.push('Charlie', 'Dan');
			expect(arr.get()).toEqual(['Alice', 'Bob', 'Charlie', 'Dan']);
		});

		it('pop() removes and returns last element', () => {
			const arr = valueArray<string>(['Alice', 'Bob']);
			const popped = arr.pop();
			expect(popped).toBe('Bob');
			expect(arr.get()).toEqual(['Alice']);
		});

		it('pop() on empty returns undefined', () => {
			const arr = valueArray<string>();
			expect(arr.pop()).toBeUndefined();
		});

		it('unshift() prepends elements', () => {
			const arr = valueArray<string>(['Bob']);
			arr.unshift('Alice');
			expect(arr.get()).toEqual(['Alice', 'Bob']);
		});

		it('shift() removes and returns first element', () => {
			const arr = valueArray<string>(['Alice', 'Bob']);
			const shifted = arr.shift();
			expect(shifted).toBe('Alice');
			expect(arr.get()).toEqual(['Bob']);
		});

		it('splice() removes and inserts elements', () => {
			const arr = valueArray<string>(['Alice', 'Bob', 'Charlie']);
			arr.splice(1, 1, 'Dan');
			expect(arr.get()).toEqual(['Alice', 'Dan', 'Charlie']);
		});

		it('filter() removes non-matching elements', () => {
			const arr = valueArray<number>([1, 2, 3, 4, 5]);
			arr.filter((n) => n % 2 === 0);
			expect(arr.get()).toEqual([2, 4]);
		});

		it('map() transforms all elements', () => {
			const arr = valueArray<number>([1, 2, 3]);
			arr.map((n) => n * 10);
			expect(arr.get()).toEqual([10, 20, 30]);
		});

		it('sort() sorts in place', () => {
			const arr = valueArray<number>([3, 1, 2]);
			arr.sort((a, b) => a - b);
			expect(arr.get()).toEqual([1, 2, 3]);
		});

		it('reverse() reverses order', () => {
			const arr = valueArray<string>(['a', 'b', 'c']);
			arr.reverse();
			expect(arr.get()).toEqual(['c', 'b', 'a']);
		});

		it('swap() swaps two indices', () => {
			const arr = valueArray<string>(['Alice', 'Bob', 'Charlie']);
			arr.swap(0, 2);
			expect(arr.get()).toEqual(['Charlie', 'Bob', 'Alice']);
		});
	});

	describe('subscribe()', () => {
		it('fires on array change', () => {
			const arr = valueArray<string>(['Alice']);
			const subscriber = vi.fn();
			arr.subscribe(subscriber);
			arr.push('Bob');
			expect(subscriber).toHaveBeenCalledOnce();
			expect(subscriber).toHaveBeenCalledWith(['Alice', 'Bob'], ['Alice']);
		});

		it('unsubscribe stops notifications', () => {
			const arr = valueArray<string>();
			const subscriber = vi.fn();
			const unsub = arr.subscribe(subscriber);
			arr.push('Alice');
			expect(subscriber).toHaveBeenCalledOnce();
			unsub();
			arr.push('Bob');
			expect(subscriber).toHaveBeenCalledOnce();
		});
	});

	describe('pipeElement()', () => {
		it('transforms elements on set', () => {
			const arr = valueArray<string>().pipeElement((s) =>
				s.trim().toLowerCase(),
			);
			arr.push(' Hello ');
			expect(arr.get()).toEqual(['hello']);
		});

		it('transforms on whole-array set', () => {
			const arr = valueArray<string>().pipeElement((s) => s.toUpperCase());
			arr.set(['alice', 'bob']);
			expect(arr.get()).toEqual(['ALICE', 'BOB']);
		});

		it('transforms on index set', () => {
			const arr = valueArray<string>(['alice']).pipeElement((s) =>
				s.toUpperCase(),
			);
			arr.set(0, 'bob');
			expect(arr.get(0)).toBe('BOB');
		});
	});

	describe('compareElementsUsing()', () => {
		it('skips update when elements compare equal', () => {
			const subscriber = vi.fn();
			const arr = valueArray<{ id: number; name: string }>([
				{ id: 1, name: 'Alice' },
			]).compareElementsUsing((a, b) => a.id === b.id);

			arr.subscribe(subscriber);
			// Same id, different object reference
			arr.set([{ id: 1, name: 'Alicia' }]);
			expect(subscriber).not.toHaveBeenCalled();
		});

		it('updates when elements differ', () => {
			const subscriber = vi.fn();
			const arr = valueArray<{ id: number }>([{ id: 1 }]).compareElementsUsing(
				(a, b) => a.id === b.id,
			);
			arr.subscribe(subscriber);
			arr.set([{ id: 2 }]);
			expect(subscriber).toHaveBeenCalledOnce();
		});
	});

	describe('use()', () => {
		it('use() returns [array, setter]', () => {
			const arr = valueArray<string>(['a']);
			const [value, setter] = arr.use();
			expect(value).toEqual(['a']);
			expect(typeof setter).toBe('function');
		});

		it('use(index) returns [element, setter]', () => {
			const arr = valueArray<string>(['Alice', 'Bob']);
			const [value, setter] = arr.use(0);
			expect(value).toBe('Alice');
			expect(typeof setter).toBe('function');
		});

		it('whole-array setter from use() replaces the array', () => {
			const arr = valueArray<string>(['a']);
			const [, setter] = arr.use();
			setter(['x', 'y', 'z']);
			expect(arr.get()).toEqual(['x', 'y', 'z']);
		});

		it('per-index setter from use(index) updates that element', () => {
			const arr = valueArray<string>(['Alice', 'Bob']);
			const [, setter] = arr.use(0);
			setter('Charlie');
			expect(arr.get(0)).toBe('Charlie');
			expect(arr.get(1)).toBe('Bob');
		});
	});

	describe('destroy()', () => {
		it('stops all subscriptions', () => {
			const arr = valueArray<string>();
			const subscriber = vi.fn();
			arr.subscribe(subscriber);
			arr.destroy();
			arr.push('Alice');
			expect(subscriber).not.toHaveBeenCalled();
		});
	});
});
