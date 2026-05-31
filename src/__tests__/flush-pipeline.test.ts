/**
 * Integration spec for the public flush-pipeline surface: `value.flush()`,
 * async-derivation `.flush()`, the `$flush()` cascade, `deferBy()` inside
 * async derivations, and `createSwitchPipe`.
 *
 * Scope boundaries (avoid duplicating these here):
 *  - Actor-model chain mechanics (accumulation, cascade, destroy,
 *    `pendingPromise` override) are unit-tested in `pipe-runtime.test.ts`.
 *  - Shipped pipe transform behavior (debounce delay/reset, throttle
 *    leading/trailing, destroy) lives in `pipe-utils.test.ts`.
 * This file owns only the flush / deferBy contract on the public API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { pipeDebounce } from '../utils/pipe-debounce.js';
import { pipeThrottle } from '../utils/pipe-throttle.js';
import { createSwitchPipe } from '../utils/switch-pipe.js';
import type { PipeFactoryDescriptor, PipeHost } from '../core/types.js';

// ─────────────────────────────────────────────────────────────────────
// value.flush() basics
// ─────────────────────────────────────────────────────────────────────

describe('value.flush() basics', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('commits a pending debounced write and resolves', async () => {
		const query = value<string>('').pipe(pipeDebounce(200));

		query.set('hel');
		query.set('hello');
		expect(query.get()).toBe(''); // still pending

		await query.flush();
		expect(query.get()).toBe('hello'); // committed by the time flush resolves
	});

	it('returns an immediately-resolved Promise when nothing is pending', async () => {
		const plain = value<string>('idle');
		await expect(plain.flush()).resolves.toBeUndefined();
		expect(plain.get()).toBe('idle');
	});

	it('is a no-op on values with only sync pipes', async () => {
		const trimmed = value<string>('').pipe((v) => v.trim());
		trimmed.set('  hi  ');
		expect(trimmed.get()).toBe('hi');
		await expect(trimmed.flush()).resolves.toBeUndefined();
		expect(trimmed.get()).toBe('hi');
	});

	it('cascades through multiple async pipes to the final commit', async () => {
		// Two actor pipes, each deferring via host.deferBy. flush() chases
		// the work: A's deferBy → A commits → B's onWrite → B's deferBy →
		// B commits → signal settled.
		const makeStep = (
			label: string,
		): PipeFactoryDescriptor<string, string> => ({
			create: (host: PipeHost<string>) => ({
				onWrite(value) {
					void host.deferBy(1_000).then(() => host.set(`${label}:${value}`));
				},
			}),
		});
		const v = value<string>('').pipe(makeStep('A')).pipe(makeStep('B'));

		v.set('x');
		await v.flush();
		expect(v.get()).toBe('B:A:x');
	});
});

// ─────────────────────────────────────────────────────────────────────
// createSwitchPipe — cancel-and-replace
// ─────────────────────────────────────────────────────────────────────

describe('createSwitchPipe', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('a new write aborts the prior handler signal', async () => {
		const aborts: number[] = [];
		const factory = createSwitchPipe<number, number>(
			async ({ value, set, deferBy, signal }) => {
				signal.addEventListener('abort', () => aborts.push(value));
				await deferBy(100);
				set(value);
			},
		);
		const v = value<number>(0).pipe(factory);
		await v.flush(); // complete the priming handler for the initial value
		v.set(1);
		v.set(2);
		v.set(3);
		expect(aborts).toEqual([1, 2]); // prior handlers aborted by next write
	});

	it('only the latest handler commits', async () => {
		const factory = createSwitchPipe<number, number>(
			async ({ value, set, deferBy }) => {
				await deferBy(100);
				set(value);
			},
		);
		const v = value<number>(0).pipe(factory);
		v.set(1);
		v.set(2);
		v.set(3);
		await vi.advanceTimersByTimeAsync(100);
		expect(v.get()).toBe(3); // only the last
	});

	it('the handler signal aborts a fetch after the deferBy', async () => {
		const fetchAborts = vi.fn();
		const factory = createSwitchPipe<string, string>(
			async ({ value, set, deferBy, signal }) => {
				await deferBy(50);
				// Simulate a fetch that listens to the same signal
				signal.addEventListener('abort', fetchAborts);
				await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
				set(value);
			},
		);
		const v = value<string>('').pipe(factory);
		v.set('a');
		await vi.advanceTimersByTimeAsync(50); // past deferBy, into the fetch
		v.set('b'); // should abort 'a' including the in-flight fetch
		expect(fetchAborts).toHaveBeenCalled();
	});

	it('onCleanup fires when a new write aborts the prior handler', async () => {
		const cleanups: string[] = [];
		const factory = createSwitchPipe<string, string>(
			async ({ value, set, deferBy, onCleanup }) => {
				onCleanup(() => cleanups.push(`cleanup:${value}`));
				await deferBy(100);
				set(value);
			},
		);
		const v = value<string>('').pipe(factory);
		await v.flush(); // complete the priming handler for the initial value
		cleanups.length = 0;
		v.set('a');
		v.set('b');
		v.set('c');
		// Supersede-cleanups run via the handler's promise `.finally`, a
		// microtask after the synchronous abort — flush the queue first.
		await vi.advanceTimersByTimeAsync(0);
		expect(cleanups).toEqual(['cleanup:a', 'cleanup:b']);
	});

	it('flush() expedites the active deferBy', async () => {
		const factory = createSwitchPipe<string, string>(
			async ({ value, set, deferBy }) => {
				await deferBy(10_000);
				set(value);
			},
		);
		const v = value<string>('').pipe(factory);
		v.set('hello');
		await v.flush();
		expect(v.get()).toBe('hello');
	});
});

// ─────────────────────────────────────────────────────────────────────
// Flush behavior of the shipped factory pipes (transform behavior itself
// is covered in pipe-utils.test.ts — only the .flush() path is here)
// ─────────────────────────────────────────────────────────────────────

describe('shipped pipe .flush()', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('pipeDebounce: .flush() short-circuits the wait', async () => {
		const v = value<string>('').pipe(pipeDebounce(1_000));
		v.set('hello');
		await v.flush();
		expect(v.get()).toBe('hello');
	});

	it('pipeThrottle: .flush() runs the trailing-edge commit immediately', async () => {
		const v = value<number>(0).pipe(pipeThrottle(1_000));
		v.set(1);
		v.set(2);
		await v.flush();
		expect(v.get()).toBe(2);
	});
});

// ─────────────────────────────────────────────────────────────────────
// deferBy in async derivations
// ─────────────────────────────────────────────────────────────────────

describe('deferBy in async derivations', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('resolves after ms when nothing interrupts', async () => {
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(200);
					return q;
				},
			},
		);
		const instance = scope.create({ q: 'hello' });
		await vi.advanceTimersByTimeAsync(200);
		expect(instance.results.get()).toBe('hello');
	});

	it('aborts when a tracked dep changes (rejects via signal)', async () => {
		const aborted = vi.fn();
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, signal, deferBy }) => {
					const q = scope.q.use();
					signal.addEventListener('abort', aborted);
					await deferBy(200);
					return q;
				},
			},
		);
		const instance = scope.create({ q: 'hel' });
		await vi.advanceTimersByTimeAsync(50);
		instance.q.set('hello'); // triggers re-run
		expect(aborted).toHaveBeenCalled();
	});

	it('aborts when instance is destroyed', async () => {
		const aborted = vi.fn();
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, signal, deferBy }) => {
					scope.q.use();
					signal.addEventListener('abort', aborted);
					await deferBy(1_000);
					return scope.q.get();
				},
			},
		);
		const instance = scope.create({ q: 'hello' });
		instance.$destroy();
		expect(aborted).toHaveBeenCalled();
	});

	it('multiple deferBy calls in one run: only the active one is flushed', async () => {
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(100);
					await deferBy(100); // second deferral
					return q;
				},
			},
		);
		const instance = scope.create({ q: 'hello' });
		// Flush only resolves the currently-awaited deferBy.
		instance.results.flush();
		await vi.advanceTimersByTimeAsync(100);
		expect(instance.results.get()).toBe('hello');
	});
});

// ─────────────────────────────────────────────────────────────────────
// Async derivation flushing
// ─────────────────────────────────────────────────────────────────────

describe('async derivation flushing', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('.flush() resolves the active deferBy and awaits the run', async () => {
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(10_000);
					return q;
				},
			},
		);
		const instance = scope.create({ q: 'hello' });
		await instance.results.flush();
		expect(instance.results.get()).toBe('hello');
	});

	it('.flush() awaits an in-flight fetch when no deferBy is active', async () => {
		let resolveFetch: ((v: string) => void) | undefined;
		const scope = valueScope(
			{ q: value<string>('') },
			{
				// No deferBy — but waits on an external promise
				results: async ({ scope }) => {
					const q = scope.q.use();
					return await new Promise<string>((resolve) => {
						resolveFetch = () => resolve(q.toUpperCase());
					});
				},
			},
		);
		const instance = scope.create({ q: 'hello' });
		// flush has nothing to expedite, but should await the in-flight run
		const flushPromise = instance.results.flush();
		expect(instance.results.get()).toBe(undefined);

		resolveFetch!('');
		await flushPromise;
		expect(instance.results.get()).toBe('HELLO');
	});

	it('.flush() resolves immediately when no run is in flight', async () => {
		const scope = valueScope(
			{ q: value<string>('hello') },
			{
				results: async ({ scope }) => scope.q.use().toUpperCase(),
			},
		);
		const instance = scope.create();
		await Promise.resolve(); // initial run
		await expect(instance.results.flush()).resolves.toBeUndefined();
		expect(instance.results.get()).toBe('HELLO');
	});

	it('differs from .recompute(): .flush() keeps inputs, .recompute() restarts', async () => {
		let runCount = 0;
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, deferBy }) => {
					runCount += 1;
					const q = scope.q.use();
					await deferBy(100);
					return q;
				},
			},
		);
		const instance = scope.create({ q: 'a' });
		await Promise.resolve();
		expect(runCount).toBe(1);

		await instance.results.flush();
		expect(runCount).toBe(1); // same run, just expedited

		instance.results.recompute();
		await Promise.resolve();
		expect(runCount).toBe(2); // fresh run
	});

	it('chases multiple sequential deferBy calls and resolves with the result', async () => {
		// Two sequential deferrals in one terminating run. flush() must
		// expedite BOTH and resolve with the returned value — a design that
		// stopped at the first re-armed deferral would resolve early, before
		// the result exists.
		const scope = valueScope(
			{ q: value<string>('') },
			{
				results: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(1_000);
					await deferBy(1_000);
					return q.toUpperCase();
				},
			},
		);
		const instance = scope.create({ q: 'hello' });
		await instance.results.flush();
		expect(instance.results.get()).toBe('HELLO');
	});

	it('resolves after the next emit on a streaming derivation (does not hang)', async () => {
		// A non-terminating loop that emits via set(). flush() can never await
		// completion here; it must expedite the active deferBy, observe the
		// next emit, and resolve.
		const scope = valueScope(
			{ start: value<number>(0) },
			{
				stream: async ({ scope, set, signal, deferBy }) => {
					let n = scope.start.use();
					while (!signal.aborted) {
						set(n);
						n += 1;
						await deferBy(1_000);
					}
				},
			},
		);
		const instance = scope.create();
		expect(instance.stream.get()).toBe(0); // first emit lands during the run's sync phase
		await instance.stream.flush(); // expedite → loop emits 1 → resolves
		expect(instance.stream.get()).toBe(1);
		instance.$destroy(); // abort the loop
	});
});

// ─────────────────────────────────────────────────────────────────────
// Scope $flush() cascade
// ─────────────────────────────────────────────────────────────────────

describe('scope $flush() cascade', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('flushes value-layer pipes before derivation layers', async () => {
		const scope = valueScope(
			{
				q: value<string>('').pipe(pipeDebounce(1_000)),
			},
			{
				results: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(1_000);
					return q;
				},
			},
		);
		const instance = scope.create();
		instance.q.set('hello');

		await instance.$flush();

		// Both the debounced pipe and the deferBy resolved without
		// advancing real time.
		expect(instance.q.get()).toBe('hello');
		expect(instance.results.get()).toBe('hello');
	});

	it('returns a Promise that resolves only after the full cascade settles', async () => {
		const scope = valueScope(
			{ q: value<string>('hello') },
			{
				layer1: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(100);
					return q + '!';
				},
			},
			{
				layer2: async ({ scope, deferBy }) => {
					const v = scope.layer1.use();
					await deferBy(100);
					return v + '?';
				},
			},
		);
		const instance = scope.create();
		await instance.$flush();
		expect(instance.layer1.get()).toBe('hello!');
		expect(instance.layer2.get()).toBe('hello!?');
	});

	it('layer N+1 sees the resolved value from layer N, not undefined', async () => {
		const seenInLayer2: Array<string | undefined> = [];
		const scope = valueScope(
			{ q: value<string>('hello') },
			{
				layer1: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(100);
					return q.toUpperCase();
				},
			},
			{
				layer2: async ({ scope, deferBy }) => {
					const v = scope.layer1.use();
					seenInLayer2.push(v);
					await deferBy(50);
					return v;
				},
			},
		);
		const instance = scope.create();
		await instance.$flush();
		// The final read inside layer2 should be the resolved layer1
		// value, not undefined.
		expect(seenInLayer2.at(-1)).toBe('HELLO');
	});

	it('$flush() walks extension layers after base layers', async () => {
		const base = valueScope(
			{ q: value<string>('hello') },
			{
				baseDeriv: async ({ scope, deferBy }) => {
					const q = scope.q.use();
					await deferBy(100);
					return q.toUpperCase();
				},
			},
		);
		const extended = base.extendValues({
			extDeriv: async ({ scope, deferBy }: any) => {
				const v = scope.baseDeriv.use();
				await deferBy(100);
				return v + '!';
			},
		});
		const instance = extended.create();
		await instance.$flush();
		expect((instance as any).extDeriv.get()).toBe('HELLO!');
	});

	it('does not hang when a field streams (non-terminating derivation)', async () => {
		const scope = valueScope(
			{ start: value<number>(0) },
			{
				stream: async ({ scope, set, signal, deferBy }) => {
					let n = scope.start.use();
					while (!signal.aborted) {
						set(n);
						n += 1;
						await deferBy(1_000);
					}
				},
			},
		);
		const instance = scope.create();
		await expect(instance.$flush()).resolves.toBeUndefined();
		instance.$destroy();
	});
});
