import { describe, it, expect } from 'vitest';
import { effectScope, nextTick, watchEffect } from 'vue';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { useValuse, useValuseModel } from '../vue/bridge.js';

describe('Vue bridge', () => {
	describe('useValuse', () => {
		it('exposes the current value and updates on change', () => {
			const count = value(0);
			const scope = effectScope();
			const ref = scope.run(() => useValuse(count))!;
			expect(ref.value).toBe(0);
			count.set(7);
			expect(ref.value).toBe(7);
			scope.stop();
		});

		it('stops updating after the effect scope is disposed', () => {
			const count = value(0);
			const scope = effectScope();
			const ref = scope.run(() => useValuse(count))!;
			count.set(1);
			expect(ref.value).toBe(1);
			scope.stop();
			count.set(2);
			expect(ref.value).toBe(1);
		});

		it('tracks a scope instance snapshot', () => {
			const person = valueScope({ name: value('Alice') });
			const instance = person.create({ name: 'Alice' });
			const scope = effectScope();
			const ref = scope.run(() => useValuse(instance))!;
			expect(ref.value).toMatchObject({ name: 'Alice' });
			(instance.name as any).set('Bob');
			expect(ref.value).toMatchObject({ name: 'Bob' });
			scope.stop();
		});
	});

	describe('useValuseModel', () => {
		it('reads through and writes back', () => {
			const count = value(0);
			const scope = effectScope();
			const model = scope.run(() => useValuseModel(count))!;
			expect(model.value).toBe(0);
			model.value = 42;
			expect(count.get()).toBe(42);
			count.set(99);
			expect(model.value).toBe(99);
			scope.stop();
		});

		it('drives a reactive effect on change', async () => {
			const count = value(1);
			const scope = effectScope();
			const seen: number[] = [];
			scope.run(() => {
				const model = useValuseModel(count);
				watchEffect(() => seen.push(model.value));
			});
			await nextTick();
			count.set(2);
			await nextTick();
			expect(seen).toContain(2);
			scope.stop();
		});
	});
});
