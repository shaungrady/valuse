import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { isComputed } from '../core/field-value.js';

/**
 * Helper to flush microtasks (Promise.resolve() chains).
 */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('async derivations', () => {
	describe('basic behavior', () => {
		it('async derivation resolves and updates the slot', async () => {
			const scope = valueScope({
				userId: value<string>('alice'),
				profile: async ({ scope: s }: { scope: any }) => {
					const id = s.userId.use();
					return { name: `User ${id}` };
				},
			});
			const instance = scope.create({ userId: 'alice' });
			// Initially undefined (async hasn't resolved yet)
			expect(instance.profile.get()).toBeUndefined();

			await flush();
			expect(instance.profile.get()).toEqual({ name: 'User alice' });
		});

		it('async derivation is isComputed', () => {
			const scope = valueScope({
				data: value<string>('x'),
				result: async ({ scope: s }: { scope: any }) => s.data.use(),
			});
			const instance = scope.create();
			expect(isComputed(instance.result)).toBe(true);
		});

		it('async derivation re-runs when tracked dep changes', async () => {
			let runCount = 0;
			const scope = valueScope({
				query: value<string>('initial'),
				result: async ({ scope: s }: { scope: any }) => {
					runCount++;
					const q = s.query.use();
					return `result for ${q}`;
				},
			});
			const instance = scope.create({ query: 'initial' });
			await flush();
			expect(runCount).toBe(1);
			expect(instance.result.get()).toBe('result for initial');

			instance.query.set('updated');
			await flush();
			expect(runCount).toBe(2);
			expect(instance.result.get()).toBe('result for updated');
		});

		it('get() does not track (no re-run)', async () => {
			let runCount = 0;
			const scope = valueScope({
				tracked: value<string>('a'),
				untracked: value<string>('x'),
				result: async ({ scope: s }: { scope: any }) => {
					runCount++;
					const t = s.tracked.use();
					const u = s.untracked.get(); // untracked
					return `${t}-${u}`;
				},
			});
			const instance = scope.create({
				tracked: 'a',
				untracked: 'x',
			});
			await flush();
			expect(runCount).toBe(1);
			expect(instance.result.get()).toBe('a-x');

			// Changing untracked dep should NOT re-run
			instance.untracked.set('y');
			await flush();
			expect(runCount).toBe(1);

			// Changing tracked dep SHOULD re-run
			instance.tracked.set('b');
			await flush();
			expect(runCount).toBe(2);
			expect(instance.result.get()).toBe('b-y'); // picks up untracked value too
		});
	});

	describe('use() after await', () => {
		it('tracks deps registered after await', async () => {
			let runCount = 0;
			const scope = valueScope({
				step1: value<string>('a'),
				step2: value<string>('x'),
				result: async ({ scope: s }: { scope: any }) => {
					runCount++;
					const v1 = s.step1.use();
					await Promise.resolve();
					const v2 = s.step2.use(); // after await — should still track
					return `${v1}-${v2}`;
				},
			});
			const instance = scope.create({ step1: 'a', step2: 'x' });
			await flush();
			expect(instance.result.get()).toBe('a-x');

			// Change step2 (registered after await) — should re-run
			instance.step2.set('y');
			await flush();
			expect(runCount).toBeGreaterThan(1);
			expect(instance.result.get()).toBe('a-y');
		});
	});

	describe('abort and cleanup', () => {
		it('provides abort signal that fires on dep change', async () => {
			let aborted = false;
			const scope = valueScope({
				query: value<string>('initial'),
				result: async ({
					scope: s,
					signal,
				}: {
					scope: any;
					signal: AbortSignal;
				}) => {
					const q = s.query.use();
					signal.addEventListener('abort', () => {
						aborted = true;
					});
					await new Promise((resolve) => setTimeout(resolve, 50));
					return `result for ${q}`;
				},
			});
			const instance = scope.create({ query: 'initial' });

			// Change dep before async resolves — should abort
			instance.query.set('changed');
			await flush();
			expect(aborted).toBe(true);
		});

		it('onCleanup fires on re-run', async () => {
			const cleanupFn = vi.fn();
			const scope = valueScope({
				dep: value<number>(1),
				result: async ({
					scope: s,
					onCleanup,
				}: {
					scope: any;
					onCleanup: any;
				}) => {
					const d = s.dep.use();
					onCleanup(cleanupFn);
					return d * 2;
				},
			});
			const instance = scope.create({ dep: 1 });
			await flush();
			expect(cleanupFn).not.toHaveBeenCalled();

			instance.dep.set(2);
			await flush();
			expect(cleanupFn).toHaveBeenCalledOnce();
		});
	});

	describe('async state tracking', () => {
		it('getAsync() returns proper state transitions', async () => {
			const scope = valueScope({
				input: value<string>('hello'),
				result: async ({ scope: s }: { scope: any }) => {
					const v = s.input.use();
					return v.toUpperCase();
				},
			});
			const instance = scope.create({ input: 'hello' });

			// Before resolution
			const initialState = instance.result.getAsync();
			expect(initialState.status).toBe('setting');

			await flush();
			const resolvedState = instance.result.getAsync();
			expect(resolvedState.status).toBe('set');
			expect(resolvedState.value).toBe('HELLO');
		});

		it('getAsync() shows error state on rejection', async () => {
			const scope = valueScope({
				input: value<string>('hello'),
				result: async ({ scope: s }: { scope: any }) => {
					s.input.use();
					throw new Error('boom');
				},
			});
			const instance = scope.create({ input: 'hello' });
			await flush();

			const state = instance.result.getAsync();
			expect(state.status).toBe('error');
			expect(state.error).toBeInstanceOf(Error);
		});
	});

	describe('set() in async derivation', () => {
		it('set() pushes intermediate values', async () => {
			const values: unknown[] = [];
			const scope = valueScope({
				input: value<number>(1),
				result: async ({ scope: s, set }: { scope: any; set: any }) => {
					const v = s.input.use();
					set(v * 10); // intermediate value
					await Promise.resolve();
					return v * 100; // final value
				},
			});
			const instance = scope.create({ input: 1 });

			// After microtask, set() should have fired
			await Promise.resolve();
			values.push(instance.result.get());
			await flush();
			values.push(instance.result.get());

			// Should have intermediate (10) then final (100)
			expect(values).toContain(10);
			expect(values[values.length - 1]).toBe(100);
		});
	});

	describe('seeded async derivation', () => {
		it('uses seed value as initial', async () => {
			const scope = valueScope({
				input: value<string>('hello'),
				result: async ({ scope: s }: { scope: any }) => {
					const v = s.input.use();
					return v.toUpperCase();
				},
			});
			const instance = scope.create({
				input: 'hello',
				result: 'CACHED',
			});

			// Before async resolves, should have seed value
			expect(instance.result.get()).toBe('CACHED');
			const state = instance.result.getAsync();
			expect(state.status).toBe('set');
			expect(state.value).toBe('CACHED');
		});
	});

	describe('cycle detection', () => {
		it('throws on self-referencing async derivation', async () => {
			const scope = valueScope({
				data: value<string>('x'),
				selfRef: async ({ scope: s }: { scope: any }) => {
					s.data.use();
					// This would try to use its own slot — cycle
					s.selfRef.use();
					return 'never';
				},
			});

			const instance = scope.create({ data: 'x' });
			await flush();

			// The derivation should have errored due to cycle
			const state = instance.selfRef.getAsync();
			expect(state.status).toBe('error');
		});
	});

	describe('$destroy()', () => {
		it('aborts the in-flight async derivation', async () => {
			let capturedSignal: AbortSignal | null = null;
			const scope = valueScope({
				data: value<string>('x'),
				result: async ({
					scope: s,
					signal,
				}: {
					scope: any;
					signal: AbortSignal;
				}) => {
					capturedSignal = signal;
					s.data.use();
					await new Promise((resolve) => setTimeout(resolve, 50));
					return 'done';
				},
			});
			const instance = scope.create();
			// Let the derivation start (capture the signal) without letting it settle.
			await Promise.resolve();
			expect(capturedSignal).not.toBeNull();
			expect(capturedSignal!.aborted).toBe(false);

			instance.$destroy();
			expect(capturedSignal!.aborted).toBe(true);
		});

		it('runs user-provided onCleanup on destroy', async () => {
			const cleanup = vi.fn();
			const scope = valueScope({
				data: value<string>('x'),
				result: async ({
					scope: s,
					onCleanup,
				}: {
					scope: any;
					onCleanup: (fn: () => void) => void;
				}) => {
					onCleanup(cleanup);
					s.data.use();
					await new Promise((resolve) => setTimeout(resolve, 50));
					return 'done';
				},
			});
			const instance = scope.create();
			// Wait for onCleanup to be registered but not for the derivation to settle.
			await Promise.resolve();
			expect(cleanup).not.toHaveBeenCalled();

			instance.$destroy();
			expect(cleanup).toHaveBeenCalledOnce();
		});
	});
});
