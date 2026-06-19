import { describe, it, expect } from 'vitest';
import type { DestroyRef, Injector } from '@angular/core';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { valuseSignal } from '../angular/bridge.js';

/** Minimal Injector that hands back a DestroyRef capturing its onDestroy cb. */
function makeInjector(): { injector: Injector; destroy: () => void } {
	let onDestroyCb: (() => void) | undefined;
	const destroyRef = {
		onDestroy: (fn: () => void) => {
			onDestroyCb = fn;
			return () => undefined;
		},
	} as unknown as DestroyRef;
	const injector = {
		get: () => destroyRef,
	} as unknown as Injector;
	return {
		injector,
		destroy: () => onDestroyCb?.(),
	};
}

describe('Angular bridge', () => {
	describe('valuseSignal', () => {
		it('exposes the current value and updates on change (manualCleanup)', () => {
			const count = value(0);
			const signal = valuseSignal(count, { manualCleanup: true });
			expect(signal()).toBe(0);
			count.set(3);
			expect(signal()).toBe(3);
		});

		it('tracks a scope instance snapshot', () => {
			const person = valueScope({ name: value('Alice') });
			const instance = person.create({ name: 'Alice' });
			const signal = valuseSignal(instance, { manualCleanup: true });
			expect(signal()).toMatchObject({ name: 'Alice' });
			(instance.name as any).set('Bob');
			expect(signal()).toMatchObject({ name: 'Bob' });
		});

		it('registers cleanup via the provided injector and stops on destroy', () => {
			const count = value(0);
			const { injector, destroy } = makeInjector();
			const signal = valuseSignal(count, { injector });
			count.set(1);
			expect(signal()).toBe(1);
			destroy();
			count.set(2);
			expect(signal()).toBe(1);
		});
	});
});
