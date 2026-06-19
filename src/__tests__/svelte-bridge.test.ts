import { describe, it, expect } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { toStore, toWritableStore } from '../svelte/bridge.js';

describe('Svelte bridge', () => {
	describe('toStore', () => {
		it('emits the current value immediately on subscribe', () => {
			const count = value(5);
			const seen: number[] = [];
			const unsubscribe = toStore(count).subscribe((v) => seen.push(v));
			expect(seen).toEqual([5]);
			unsubscribe();
		});

		it('emits on change and stops after unsubscribe', () => {
			const count = value(0);
			const seen: number[] = [];
			const unsubscribe = toStore(count).subscribe((v) => seen.push(v));
			count.set(1);
			count.set(2);
			unsubscribe();
			count.set(3);
			expect(seen).toEqual([0, 1, 2]);
		});

		it('tracks a scope instance snapshot', () => {
			const person = valueScope({ name: value('Alice') });
			const instance = person.create({ name: 'Alice' });
			const seen: Array<{ name: string }> = [];
			const unsubscribe = toStore(instance).subscribe((v) => seen.push(v));
			(instance.name as any).set('Bob');
			unsubscribe();
			expect(seen[0]).toMatchObject({ name: 'Alice' });
			expect(seen.at(-1)).toMatchObject({ name: 'Bob' });
		});
	});

	describe('toWritableStore', () => {
		it('writes back through set and update', () => {
			const count = value(0);
			const store = toWritableStore(count);
			store.set(10);
			expect(count.get()).toBe(10);
			store.update((n) => n + 5);
			expect(count.get()).toBe(15);
		});

		it('reflects external changes to subscribers', () => {
			const count = value(1);
			const seen: number[] = [];
			const unsubscribe = toWritableStore(count).subscribe((v) => seen.push(v));
			count.set(2);
			unsubscribe();
			expect(seen).toEqual([1, 2]);
		});
	});
});
