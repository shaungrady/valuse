import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeferral } from '../core/utils/deferral.js';

describe('createDeferral', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('resolves after the given delay', async () => {
		const d = createDeferral();
		const settled = vi.fn();
		void d.deferBy(100).then(settled);
		await vi.advanceTimersByTimeAsync(99);
		expect(settled).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toHaveBeenCalledTimes(1);
	});

	it('flush() resolves the in-flight deferral immediately', async () => {
		const d = createDeferral();
		const settled = vi.fn();
		void d.deferBy(10_000).then(settled);
		d.flush();
		await Promise.resolve();
		expect(settled).toHaveBeenCalledTimes(1);
	});

	it('flush() is a no-op when idle', () => {
		const d = createDeferral();
		expect(() => d.flush()).not.toThrow();
		expect(d.pending).toBeNull();
	});

	it('cancel() rejects the in-flight deferral with an AbortError', async () => {
		const d = createDeferral();
		const rejection = d.deferBy(10_000);
		d.cancel();
		await expect(rejection).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('pending reflects the in-flight deferral and clears on resolve', async () => {
		const d = createDeferral();
		expect(d.pending).toBeNull();
		const promise = d.deferBy(100);
		expect(d.pending).toBe(promise);
		await vi.advanceTimersByTimeAsync(100);
		expect(d.pending).toBeNull();
	});

	it('pending clears after flush', async () => {
		const d = createDeferral();
		void d.deferBy(100);
		expect(d.pending).not.toBeNull();
		d.flush();
		await Promise.resolve();
		expect(d.pending).toBeNull();
	});

	it('rejects the in-flight deferral when the parent signal aborts', async () => {
		const controller = new AbortController();
		const d = createDeferral(controller.signal);
		const rejection = d.deferBy(10_000);
		controller.abort();
		await expect(rejection).rejects.toBeDefined();
		expect(d.pending).toBeNull();
	});

	it('rejects new deferrals synchronously after the parent already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const d = createDeferral(controller.signal);
		await expect(d.deferBy(100)).rejects.toBeDefined();
	});

	it('propagates the parent signal reason on abort', async () => {
		const controller = new AbortController();
		const d = createDeferral(controller.signal);
		const rejection = d.deferBy(10_000);
		const reason = new Error('dep changed');
		controller.abort(reason);
		await expect(rejection).rejects.toBe(reason);
	});

	it('sequential deferrals each resolve in turn', async () => {
		const d = createDeferral();
		const order: string[] = [];
		const run = (async () => {
			await d.deferBy(100);
			order.push('first');
			await d.deferBy(100);
			order.push('second');
		})();
		await vi.advanceTimersByTimeAsync(100);
		expect(order).toEqual(['first']);
		await vi.advanceTimersByTimeAsync(100);
		expect(order).toEqual(['first', 'second']);
		await run;
	});

	it('superseding deferral rejects the prior one', async () => {
		const d = createDeferral();
		const first = d.deferBy(100);
		const second = d.deferBy(100);
		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		d.flush();
		await expect(second).resolves.toBeUndefined();
	});

	it('parent-abort listeners are detached on every settle path (no accumulation)', async () => {
		// Regression: createDeferral used to attach a `{ once: true }`
		// parent-abort listener at construction and only detach on abort.
		// For a long-lived signal driving many sequential deferrals (e.g.
		// `host.deferBy` inside a high-frequency throttle), listeners
		// accumulated for the lifetime of the value. The listener now lives
		// only while a deferral is active.
		const controller = new AbortController();
		const addSpy = vi.spyOn(controller.signal, 'addEventListener');
		const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
		const d = createDeferral(controller.signal);

		// Mix of settle paths: timer-fire, flush, cancel, supersede.
		for (let i = 0; i < 25; i++) {
			void d.deferBy(10);
			await vi.advanceTimersByTimeAsync(10); // timer-fire
		}
		for (let i = 0; i < 25; i++) {
			void d.deferBy(10_000);
			d.flush(); // flush
			await Promise.resolve();
		}
		for (let i = 0; i < 25; i++) {
			void d.deferBy(10_000).catch(() => {
				/* expected */
			});
			d.cancel(); // cancel
		}
		for (let i = 0; i < 25; i++) {
			void d.deferBy(10_000).catch(() => {
				/* superseded next iteration */
			});
			void d.deferBy(10_000).catch(() => {
				/* superseded or cancelled at the end */
			});
		}
		d.cancel(); // drain the final pending

		// Every add must have a matching remove.
		expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length);
		expect(addSpy.mock.calls.length).toBeGreaterThan(0); // sanity
	});
});
