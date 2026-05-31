import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { pipeEnum } from '../utils/pipe-enum.js';
import { pipeDebounce } from '../utils/pipe-debounce.js';
import { pipeThrottle } from '../utils/pipe-throttle.js';
import { pipeBatch } from '../utils/pipe-batch.js';
import { pipeFilter } from '../utils/pipe-filter.js';
import { pipeScan } from '../utils/pipe-scan.js';
import { pipeUnique } from '../utils/pipe-unique.js';

describe('pipeDebounce', () => {
	// The actor-model debounce commits on a microtask after the timer, so
	// tests advance with `advanceTimersByTimeAsync` (which flushes the
	// microtask queue) rather than the synchronous `advanceTimersByTime`.
	it('delays the value', async () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeDebounce(100));
		v.set('a');
		expect(v.get()).toBe('');
		await vi.advanceTimersByTimeAsync(100);
		expect(v.get()).toBe('a');
		vi.useRealTimers();
	});

	it('resets on new value', async () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeDebounce(100));
		v.set('a');
		await vi.advanceTimersByTimeAsync(50);
		v.set('b');
		await vi.advanceTimersByTimeAsync(50);
		expect(v.get()).toBe(''); // still waiting
		await vi.advanceTimersByTimeAsync(50);
		expect(v.get()).toBe('b');
		vi.useRealTimers();
	});

	it('clears pending timer on destroy', async () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeDebounce(100));
		v.set('a');
		// Timer is pending; destroy should abort it
		v.destroy();
		await vi.advanceTimersByTimeAsync(100);
		expect(v.get()).toBe(''); // value was never set because timer was cleared
		vi.useRealTimers();
	});
});

describe('pipeThrottle', () => {
	it('passes first value after initial window', async () => {
		vi.useFakeTimers();
		const v = value<string | null>(null).pipe(pipeThrottle(100));
		// Initial value is piped through on creation, starting the throttle window
		await vi.advanceTimersByTimeAsync(100); // let initial window expire
		v.set('a');
		expect(v.get()).toBe('a'); // passes immediately, new window starts
		vi.useRealTimers();
	});

	it('clears pending timer on destroy', async () => {
		vi.useFakeTimers();
		const v = value<string | null>(null).pipe(pipeThrottle(100));
		await vi.advanceTimersByTimeAsync(100); // let initial window expire
		v.set('a'); // passes immediately, starts new window
		v.set('b'); // trailing, stored but timer pending
		v.destroy();
		await vi.advanceTimersByTimeAsync(100);
		expect(v.get()).toBe('a'); // trailing 'b' was never emitted
		vi.useRealTimers();
	});

	it('ignores intermediate values within window', async () => {
		vi.useFakeTimers();
		const v = value<string | null>(null).pipe(pipeThrottle(100));
		await vi.advanceTimersByTimeAsync(100); // let initial window expire
		v.set('a');
		expect(v.get()).toBe('a'); // first passes
		v.set('b');
		v.set('c');
		expect(v.get()).toBe('a'); // still in throttle window
		await vi.advanceTimersByTimeAsync(100);
		expect(v.get()).toBe('c'); // trailing value
		vi.useRealTimers();
	});
});

describe('pipeBatch', () => {
	it('batches synchronous writes to the next tick', async () => {
		vi.useFakeTimers();
		const v = value('').pipe(pipeBatch());
		v.set('a');
		v.set('b');
		v.set('c');
		expect(v.get()).toBe('');
		await vi.advanceTimersByTimeAsync(0);
		expect(v.get()).toBe('c'); // last value wins
		vi.useRealTimers();
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

/**
 * Bug: chaining a factory pipe after a sync pipe used to re-run every
 * sync pre-step against an already-transformed initial value, because
 * `Value.pipe(<factory>)` calls `newValue.set(currentValue)` to "re-apply
 * the initial value through the full pipeline" — but `currentValue` is the
 * previous Value's signal value, which has already been piped. So `set()`
 * walks the sync steps a second time. For `value(5).pipe(x => x * 2).pipe(<factory>)`
 * the stored initial becomes 20 instead of the intended 10.
 *
 * Fix: in `Value.pipe(<factory>)`, hand `currentValue` directly into the
 * first activated factory's `write`, skipping the pre-factory sync stage
 * (those steps are already baked into `currentValue`).
 */
describe('sync → factory pipe ordering', () => {
	it('sync pipe followed by a sync-style factory applies the sync only once', () => {
		const v = value(5)
			.pipe((x: number) => x * 2)
			.pipe(pipeFilter((x: number) => x > 5));
		// 5 doubled to 10; filter(>5) accepts 10. Expected: 10.
		expect(v.get()).toBe(10);
	});

	it('subsequent writes still flow through sync → factory exactly once', () => {
		const v = value(5)
			.pipe((x: number) => x * 2)
			.pipe(pipeFilter((x: number) => x > 5));
		v.set(4); // 4 * 2 = 8 > 5 → passes
		expect(v.get()).toBe(8);
		v.set(2); // 2 * 2 = 4 ≤ 5 → filtered, stays at 8
		expect(v.get()).toBe(8);
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

/**
 * Standalone `Value.pipe(factory)` primes the chain with the current value
 * so stateful actors observe the seed. Scope-field activation now primes
 * its instance chain with the same seed (captured as `factorySeed` at
 * definition time). Before that fix, scope fields with `pipeScan` /
 * `pipeUnique` saw a fresh actor — leading to off-by-one accumulators and
 * different dedupe behavior than standalone.
 */
describe('scope-field actor priming matches standalone', () => {
	it('pipeScan: first set folds with the seeded accumulator (same as standalone)', () => {
		// Standalone: prime(5) folds 5 into acc=0 → acc=5. set(3) → 5+3=8.
		const standalone = value(5).pipe(
			pipeScan((acc: number, n: number) => acc + n, 0),
		);
		expect(standalone.get()).toBe(5);
		standalone.set(3);
		expect(standalone.get()).toBe(8);

		// Scope field: same expected outcome (the prime is what makes it so).
		const scoped = valueScope({
			n: value(5).pipe(pipeScan((acc: number, n: number) => acc + n, 0)),
		}).create();
		expect(scoped.n.get()).toBe(5);
		scoped.n.set(3);
		expect(scoped.n.get()).toBe(8);
	});

	it('pipeUnique: a write equal to the seed is deduped (same as standalone)', () => {
		const standaloneCalls = vi.fn();
		const standalone = value('a').pipe(pipeUnique());
		standalone.subscribe(standaloneCalls);
		standalone.set('a'); // equals seeded last → deduped
		standalone.set('b'); // emits
		expect(standaloneCalls).toHaveBeenCalledTimes(1);

		const scopedCalls = vi.fn();
		const scoped = valueScope({ s: value('a').pipe(pipeUnique()) }).create();
		scoped.s.subscribe(scopedCalls);
		scoped.s.set('a'); // equals seeded last → deduped (was emitting before fix)
		scoped.s.set('b');
		expect(scopedCalls).toHaveBeenCalledTimes(1);
	});

	it('user-supplied initial seeds the actor with that value, not the default', () => {
		const scope = valueScope({
			n: value(0).pipe(pipeScan((acc: number, n: number) => acc + n, 0)),
		});
		const inst = scope.create({ n: 10 }); // user initial 10
		expect(inst.n.get()).toBe(10); // post-prime: acc = 0 + 10
		inst.n.set(3);
		expect(inst.n.get()).toBe(13); // acc = 10 + 3 (not 0+3)
	});
});
