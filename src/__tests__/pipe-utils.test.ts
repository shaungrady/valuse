import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { pipeEnum } from '../utils/pipeEnum.js';
import { pipeDebounce } from '../utils/pipeDebounce.js';
import { pipeThrottle } from '../utils/pipeThrottle.js';
import { pipeBatch } from '../utils/pipeBatch.js';
import { pipeFilter } from '../utils/pipeFilter.js';
import { pipeScan } from '../utils/pipeScan.js';
import { pipeUnique } from '../utils/pipeUnique.js';

describe('pipeDebounce', () => {
	it('delays the value', async () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeDebounce(100));
		v.set('a');
		expect(v.get()).toBe('');
		vi.advanceTimersByTime(100);
		expect(v.get()).toBe('a');
		vi.useRealTimers();
	});

	it('resets on new value', async () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeDebounce(100));
		v.set('a');
		vi.advanceTimersByTime(50);
		v.set('b');
		vi.advanceTimersByTime(50);
		expect(v.get()).toBe(''); // still waiting
		vi.advanceTimersByTime(50);
		expect(v.get()).toBe('b');
		vi.useRealTimers();
	});

	it('clears pending timer on destroy', () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeDebounce(100));
		v.set('a');
		// Timer is pending; destroy should clear it
		v.destroy();
		vi.advanceTimersByTime(100);
		expect(v.get()).toBe(''); // value was never set because timer was cleared
		vi.useRealTimers();
	});
});

describe('pipeThrottle', () => {
	it('passes first value after initial window', () => {
		vi.useFakeTimers();
		const v = value<string | null>(null).pipe(pipeThrottle(100));
		// Initial value is piped through on creation, starting the throttle window
		vi.advanceTimersByTime(100); // let initial window expire
		v.set('a');
		expect(v.get()).toBe('a'); // passes immediately, new window starts
		vi.useRealTimers();
	});

	it('clears pending timer on destroy', () => {
		vi.useFakeTimers();
		const v = value<string | null>(null).pipe(pipeThrottle(100));
		vi.advanceTimersByTime(100); // let initial window expire
		v.set('a'); // passes immediately, starts new window
		v.set('b'); // trailing, stored but timer pending
		v.destroy();
		vi.advanceTimersByTime(100);
		expect(v.get()).toBe('a'); // trailing 'b' was never emitted
		vi.useRealTimers();
	});

	it('ignores intermediate values within window', () => {
		vi.useFakeTimers();
		const v = value<string | null>(null).pipe(pipeThrottle(100));
		vi.advanceTimersByTime(100); // let initial window expire
		v.set('a');
		expect(v.get()).toBe('a'); // first passes
		v.set('b');
		v.set('c');
		expect(v.get()).toBe('a'); // still in throttle window
		vi.advanceTimersByTime(100);
		expect(v.get()).toBe('c'); // trailing value
		vi.useRealTimers();
	});
});

describe('pipeBatch', () => {
	it('batches to microtask', async () => {
		const v = value('').pipe(pipeBatch());
		v.set('a');
		v.set('b');
		v.set('c');
		expect(v.get()).toBe('');
		await Promise.resolve();
		expect(v.get()).toBe('c'); // last value wins
	});
});

describe('pipeFilter', () => {
	it('only passes matching values', () => {
		const v = value(0).pipe(pipeFilter((n: number) => n > 0));
		v.set(-1);
		expect(v.get()).toBe(0); // filtered out
		v.set(5);
		expect(v.get()).toBe(5);
	});
});

describe('pipeScan', () => {
	it('accumulates values', () => {
		const v = value(0).pipe(
			pipeScan((acc: number, val: number) => acc + val, 0),
		);
		v.set(1);
		expect(v.get()).toBe(1);
		v.set(2);
		expect(v.get()).toBe(3);
		v.set(3);
		expect(v.get()).toBe(6);
	});
});

describe('pipeUnique', () => {
	it('skips duplicate values', () => {
		const subscriber = vi.fn();
		const v = value('').pipe(pipeUnique());
		v.subscribe(subscriber);
		v.set('a');
		v.set('a'); // duplicate
		v.set('b');
		// subscriber should have been called for 'a' and 'b' only
		expect(subscriber).toHaveBeenCalledTimes(2);
	});

	it('uses custom comparator', () => {
		const subscriber = vi.fn();
		const v = value({ id: 0 }).pipe(
			pipeUnique((a: { id: number }, b: { id: number }) => a.id === b.id),
		);
		v.subscribe(subscriber);
		v.set({ id: 1 });
		v.set({ id: 1 }); // same id
		expect(subscriber).toHaveBeenCalledTimes(1);
	});
});

describe('pipeEnum', () => {
	it('passes through allowed values', () => {
		const v = value('list').pipe(pipeEnum(['list', 'grid']));
		v.set('grid');
		expect(v.get()).toBe('grid');
		v.set('list');
		expect(v.get()).toBe('list');
	});

	it('falls back to the first element for invalid values', () => {
		const v = value('list').pipe(pipeEnum(['list', 'grid']));
		v.set('banana' as string);
		expect(v.get()).toBe('list');
	});

	it('falls back for null and undefined', () => {
		const v = value<string | null>('list').pipe(pipeEnum(['list', 'grid']));
		v.set(null);
		expect(v.get()).toBe('list');
	});

	it('applies to the default value', () => {
		const v = value('invalid' as string).pipe(pipeEnum(['list', 'grid']));
		expect(v.get()).toBe('list');
	});

	it('works with numbers', () => {
		const v = value(1).pipe(pipeEnum([1, 2, 3]));
		v.set(2);
		expect(v.get()).toBe(2);
		v.set(99 as number);
		expect(v.get()).toBe(1);
	});
});
