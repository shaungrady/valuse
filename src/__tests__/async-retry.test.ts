import { describe, it, expect, vi } from 'vitest';
import { asyncRetry } from '../utils/async-retry.js';

describe('asyncRetry', () => {
	describe('happy path', () => {
		it('returns the value on first success', async () => {
			const controller = new AbortController();
			const fn = vi.fn(async () => 42);
			const result = await asyncRetry({ signal: controller.signal }, fn);
			expect(result).toBe(42);
			expect(fn).toHaveBeenCalledOnce();
		});

		it('retries until success and returns that value', async () => {
			const controller = new AbortController();
			let calls = 0;
			const fn = vi.fn(async () => {
				calls++;
				if (calls < 3) throw new Error(`attempt ${calls}`);
				return 'ok';
			});
			const result = await asyncRetry(
				{ signal: controller.signal, backoff: 1 },
				fn,
			);
			expect(result).toBe('ok');
			expect(fn).toHaveBeenCalledTimes(3);
		});
	});

	describe('failure path', () => {
		it('throws the last error after max attempts', async () => {
			const controller = new AbortController();
			const fn = vi.fn(async (): Promise<never> => {
				throw new Error(`failure`);
			});
			await expect(
				asyncRetry({ signal: controller.signal, backoff: 1 }, fn),
			).rejects.toThrow('failure');
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('with max=1 calls fn once and throws on failure', async () => {
			const controller = new AbortController();
			const fn = vi.fn(async (): Promise<never> => {
				throw new Error('only-shot');
			});
			await expect(
				asyncRetry({ signal: controller.signal, max: 1, backoff: 1 }, fn),
			).rejects.toThrow('only-shot');
			expect(fn).toHaveBeenCalledOnce();
		});
	});

	describe('abort handling', () => {
		it('aborting between attempts throws the abort reason and stops retrying', async () => {
			const controller = new AbortController();
			let calls = 0;
			const fn = vi.fn(async () => {
				calls++;
				if (calls === 1) {
					// Abort before the retry delay finishes.
					controller.abort(new Error('user aborted'));
				}
				throw new Error('inner');
			});
			await expect(
				asyncRetry({ signal: controller.signal, backoff: 10, max: 5 }, fn),
			).rejects.toThrow('user aborted');
			expect(fn).toHaveBeenCalledOnce();
		});

		it('aborting during fn surfaces the abort reason, not the fn error', async () => {
			const controller = new AbortController();
			const fn = vi.fn(async () => {
				controller.abort(new Error('user aborted'));
				throw new Error('inner');
			});
			await expect(
				asyncRetry({ signal: controller.signal, backoff: 1 }, fn),
			).rejects.toThrow('user aborted');
		});

		/**
		 * Repro: when the consumer passes a pre-aborted signal, we should
		 * not call `fn` at all and should reject immediately with the
		 * abort reason. Current behavior calls `fn` once, then catches
		 * its error (if any) and bails. That's "works" but wasteful and
		 * could fire user-side side effects in `fn` after cancellation.
		 *
		 * If `fn` happens to succeed despite the pre-aborted signal,
		 * current behavior even returns the result — clearly wrong for
		 * a "cancelled before start" contract.
		 */
		it('pre-aborted signal rejects immediately without invoking fn', async () => {
			const controller = new AbortController();
			controller.abort(new Error('cancelled before start'));
			const fn = vi.fn(async () => 'should-not-run');
			await expect(
				asyncRetry({ signal: controller.signal }, fn),
			).rejects.toThrow('cancelled before start');
			expect(fn).not.toHaveBeenCalled();
		});
	});

	describe('option edge cases', () => {
		/**
		 * Documentation contract: max counts the total number of attempts
		 * (including the first). Pin: max=2 means one initial call plus
		 * one retry.
		 */
		it('max=2 calls fn at most twice', async () => {
			const controller = new AbortController();
			const fn = vi.fn(async (): Promise<never> => {
				throw new Error('still failing');
			});
			await expect(
				asyncRetry({ signal: controller.signal, max: 2, backoff: 1 }, fn),
			).rejects.toThrow('still failing');
			expect(fn).toHaveBeenCalledTimes(2);
		});

		/**
		 * `max < 1` (including 0, negatives, and NaN) is a contract violation:
		 * the loop never runs, so the old code threw a bare `undefined`. Surface
		 * a clear RangeError instead and never invoke fn.
		 */
		it('rejects with a RangeError when max < 1 instead of throwing undefined', async () => {
			const controller = new AbortController();
			const fn = vi.fn(async () => 1);
			for (const bad of [0, -1, Number.NaN]) {
				await expect(
					asyncRetry({ signal: controller.signal, max: bad }, fn),
				).rejects.toThrow(RangeError);
			}
			expect(fn).not.toHaveBeenCalled();
		});
	});
});
