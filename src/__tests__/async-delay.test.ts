import { describe, it, expect, vi } from 'vitest';
import { asyncDelay } from '../utils/async-delay.js';
import { asyncPoll } from '../utils/async-poll.js';

/** Count net abort listeners attached to a signal across a test body. */
function trackListeners(signal: AbortSignal): () => number {
	let added = 0;
	let removed = 0;
	const add = signal.addEventListener.bind(signal);
	const remove = signal.removeEventListener.bind(signal);
	signal.addEventListener = ((...args: Parameters<typeof add>) => {
		added++;
		return add(...args);
	}) as typeof signal.addEventListener;
	signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
		removed++;
		return remove(...args);
	}) as typeof signal.removeEventListener;
	return () => added - removed;
}

describe('asyncDelay', () => {
	it('resolves after the delay elapses', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			let resolved = false;
			const promise = asyncDelay({ ms: 100, signal: controller.signal }).then(
				() => {
					resolved = true;
				},
			);
			await vi.advanceTimersByTimeAsync(99);
			expect(resolved).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await promise;
			expect(resolved).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects with the abort reason when the signal fires before the delay', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const promise = asyncDelay({ ms: 1_000, signal: controller.signal });
			void promise.catch(() => {});
			controller.abort(new Error('cancelled'));
			await expect(promise).rejects.toThrow('cancelled');
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects immediately when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort(new Error('already'));
		await expect(
			asyncDelay({ ms: 1_000, signal: controller.signal }),
		).rejects.toThrow('already');
	});

	// Regression: the abort listener is registered `{ once: true }`, so it
	// self-removes only when the signal actually fires. On the timeout (happy)
	// path it must be detached explicitly — otherwise callers that reuse one
	// long-lived signal across many delays accumulate one listener per call.
	it('does not leak abort listeners on the timeout path', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const net = trackListeners(controller.signal);
			for (let i = 0; i < 100; i++) {
				const promise = asyncDelay({ ms: 10, signal: controller.signal });
				await vi.advanceTimersByTimeAsync(10);
				await promise;
			}
			expect(net()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('asyncPoll', () => {
	it('calls fn immediately and on each interval until aborted', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			let calls = 0;
			const done = asyncPoll({ ms: 10, signal: controller.signal }, () => {
				calls++;
			});
			expect(calls).toBe(1); // immediate first call
			await vi.advanceTimersByTimeAsync(10);
			expect(calls).toBe(2);
			await vi.advanceTimersByTimeAsync(20);
			expect(calls).toBe(4);
			controller.abort();
			await done;
		} finally {
			vi.useRealTimers();
		}
	});

	// Regression: asyncPoll loops asyncDelay against the SAME long-lived signal.
	// Without listener cleanup on asyncDelay's timeout path, listeners pile up
	// on that signal for the lifetime of the poll — an unbounded steady-state
	// leak. Listener count must track active delays (~1), not total iterations.
	it('does not accumulate abort listeners across iterations', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const net = trackListeners(controller.signal);
			let polls = 0;
			const done = asyncPoll({ ms: 10, signal: controller.signal }, () => {
				polls++;
			});
			for (let i = 0; i < 100; i++) await vi.advanceTimersByTimeAsync(10);
			expect(polls).toBeGreaterThan(50);
			// At most the one listener for the currently-pending delay.
			expect(net()).toBeLessThanOrEqual(1);
			controller.abort();
			await vi.advanceTimersByTimeAsync(10);
			await done;
			// The final pending delay's listener auto-removes when the signal
			// fires (`{ once: true }`), which doesn't route through
			// removeEventListener — so the spy can't observe that drop. The
			// steady-state count above is the real regression guard.
			expect(net()).toBeLessThanOrEqual(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
