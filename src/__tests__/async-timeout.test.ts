import { describe, it, expect, vi } from 'vitest';
import { asyncTimeout } from '../utils/async-timeout.js';

describe('asyncTimeout', () => {
	it('resolves with the value when fn finishes before the timeout', async () => {
		const controller = new AbortController();
		const result = await asyncTimeout(
			{ ms: 1_000, signal: controller.signal },
			() => Promise.resolve(42),
		);
		expect(result).toBe(42);
	});

	it('rejects with the abort reason when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort(new Error('nope'));
		await expect(
			asyncTimeout({ ms: 1_000, signal: controller.signal }, () =>
				Promise.resolve(1),
			),
		).rejects.toThrow('nope');
	});

	it('rejects as soon as the timeout elapses, without waiting for fn', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			let fnSettled = false;
			const promise = asyncTimeout(
				{ ms: 50, signal: controller.signal },
				() =>
					// fn that takes far longer than the timeout
					new Promise<string>((resolve) => {
						setTimeout(() => {
							fnSettled = true;
							resolve('too late');
						}, 5_000);
					}),
			);
			// Attach a handler now so the rejection that fires *during* the timer
			// advance below isn't briefly flagged as unhandled.
			void promise.catch(() => {});
			// Advance only past the timeout, NOT past fn's own delay.
			await vi.advanceTimersByTimeAsync(60);
			await expect(promise).rejects.toThrow('Timeout');
			// The timeout must win before fn ever settles.
			expect(fnSettled).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects with the external abort reason if the signal fires before fn settles', async () => {
		const controller = new AbortController();
		const promise = asyncTimeout(
			{ ms: 5_000, signal: controller.signal },
			() => new Promise<string>(() => {}), // never settles on its own
		);
		controller.abort(new Error('aborted by caller'));
		await expect(promise).rejects.toThrow('aborted by caller');
	});
});
