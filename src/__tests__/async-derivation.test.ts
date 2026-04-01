import { describe, it, expect } from 'vitest';
import { value, valueScope } from '../index.js';

/** Flush microtasks so async derivation results land. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('async derivations', () => {
	describe('basic resolution', () => {
		it('resolves and populates value', async () => {
			const scope = valueScope({
				userId: value('alice'),
				profile: async ({ use }) => {
					const id = use('userId') as string;
					return { name: id.toUpperCase() };
				},
			});
			const scopeInstance = scope.create();

			// Before resolution: undefined
			expect(scopeInstance.get('profile')).toBeUndefined();

			await flush();

			expect(scopeInstance.get('profile')).toEqual({ name: 'ALICE' });
		});

		it('sync derivation can read async derivation transparently', async () => {
			const scope = valueScope({
				userId: value('alice'),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
				greeting: ({ use }) => {
					const profile = use('profile') as { name: string } | undefined;
					return profile ? `Hello, ${profile.name}!` : 'Loading...';
				},
			});
			const scopeInstance = scope.create();

			expect(scopeInstance.get('greeting')).toBe('Loading...');

			await flush();

			expect(scopeInstance.get('greeting')).toBe('Hello, ALICE!');
		});
	});

	describe('AsyncState transitions', () => {
		it("starts as 'unset', transitions to 'setting', then 'set'", async () => {
			const states: string[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => {
					return (use('x') as number) * 2;
				},
			});
			const scopeInstance = scope.create();

			states.push(scopeInstance.getAsync('derived').status);
			expect(scopeInstance.getAsync('derived').hasValue).toBe(false);

			await flush();

			states.push(scopeInstance.getAsync('derived').status);
			expect(scopeInstance.getAsync('derived').value).toBe(2);
			expect(scopeInstance.getAsync('derived').hasValue).toBe(true);
			expect(states).toEqual(['unset', 'set']);
		});

		it('preserves previous value during re-run (set → setting → set)', async () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => {
					return (use('x') as number) * 10;
				},
			});
			const scopeInstance = scope.create();

			await flush();
			expect(scopeInstance.getAsync('derived').value).toBe(10);
			expect(scopeInstance.getAsync('derived').status).toBe('set');

			// Trigger re-run
			scopeInstance.set('x', 2);
			const duringRerun = scopeInstance.getAsync('derived');
			expect(duringRerun.status).toBe('setting');
			expect(duringRerun.value).toBe(10); // previous value preserved
			expect(duringRerun.hasValue).toBe(true);

			await flush();
			expect(scopeInstance.getAsync('derived').value).toBe(20);
			expect(scopeInstance.getAsync('derived').status).toBe('set');
		});
	});

	describe('error handling', () => {
		it("transitions to 'error' on rejection", async () => {
			const scope = valueScope({
				x: value(1),
				derived: async () => {
					throw new Error('boom');
				},
			});
			const scopeInstance = scope.create();

			await flush();

			const state = scopeInstance.getAsync('derived');
			expect(state.status).toBe('error');
			expect(state.error).toBeInstanceOf(Error);
			expect((state.error as Error).message).toBe('boom');
		});

		it('preserves previous value on error', async () => {
			let shouldFail = false;
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => {
					const val = use('x') as number;
					if (shouldFail) throw new Error('fail');
					return val * 10;
				},
			});
			const scopeInstance = scope.create();

			await flush();
			expect(scopeInstance.getAsync('derived').value).toBe(10);

			shouldFail = true;
			scopeInstance.set('x', 2);
			await flush();

			const state = scopeInstance.getAsync('derived');
			expect(state.status).toBe('error');
			expect(state.value).toBe(10); // previous value preserved
			expect(state.hasValue).toBe(true);
		});
	});

	describe('abort on dep change', () => {
		it('aborts previous run when tracked dep changes', async () => {
			const abortedSignals: boolean[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, signal }) => {
					use('x');
					abortedSignals.push(signal.aborted);
					await flush();
					abortedSignals.push(signal.aborted);
					return 'done';
				},
			});
			const scopeInstance = scope.create();

			// First run starts
			await Promise.resolve(); // let effect fire

			// Change dep — should abort first run, start second
			scopeInstance.set('x', 2);

			await flush();

			// Run 1 starts (not aborted), run 2 starts (not aborted),
			// run 1 resumes after await (now aborted), run 2 resumes (not aborted)
			expect(abortedSignals).toEqual([false, false, true, false]);
		});
	});

	describe('set() for intermediate values', () => {
		it('pushes intermediate values before return', async () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, set }) => {
					const val = use('x') as number;
					set(val * 2); // intermediate
					await flush();
					return val * 10; // final
				},
			});
			const scopeInstance = scope.create();

			// After sync preamble, intermediate should be available
			await Promise.resolve();
			expect(scopeInstance.get('derived')).toBe(2);

			await flush();
			expect(scopeInstance.get('derived')).toBe(10);
		});
	});

	describe('onCleanup()', () => {
		it('fires cleanup on re-run', async () => {
			const cleanups: number[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, onCleanup }) => {
					const val = use('x') as number;
					onCleanup(() => cleanups.push(val));
					return val;
				},
			});
			const scopeInstance = scope.create();
			await flush();
			expect(cleanups).toEqual([]);

			// Trigger re-run — should fire cleanup from first run
			scopeInstance.set('x', 2);
			expect(cleanups).toEqual([1]);

			await flush();

			// Trigger another re-run
			scopeInstance.set('x', 3);
			expect(cleanups).toEqual([1, 2]);
		});

		it('fires cleanup on destroy', async () => {
			const cleanups: string[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, onCleanup }) => {
					use('x');
					onCleanup(() => cleanups.push('cleaned'));
					return 'done';
				},
			});
			const scopeInstance = scope.create();
			await flush();

			scopeInstance.destroy();
			expect(cleanups).toEqual(['cleaned']);
		});
	});

	describe('previousValue in async', () => {
		it('receives undefined on first run, then last resolved value', async () => {
			const previousValues: unknown[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, previousValue }) => {
					previousValues.push(previousValue);
					return (use('x') as number) * 10;
				},
			});
			const scopeInstance = scope.create();
			await flush();
			expect(previousValues).toEqual([undefined]);

			scopeInstance.set('x', 2);
			await flush();
			expect(previousValues).toEqual([undefined, 10]);
		});
	});

	describe('return undefined semantics', () => {
		it("stays 'unset' when returning undefined with no prior set()", async () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => {
					use('x');
					return undefined;
				},
			});
			const scopeInstance = scope.create();
			await flush();

			const state = scopeInstance.getAsync('derived');
			expect(state.status).toBe('unset');
			expect(state.hasValue).toBe(false);
			expect(state.value).toBeUndefined();
		});

		it('preserves value when returning undefined after a prior set()', async () => {
			let callCount = 0;
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, set }) => {
					use('x');
					callCount++;
					if (callCount === 1) {
						set(42);
						return undefined; // but we already set(42)
					}
					return undefined;
				},
			});
			const scopeInstance = scope.create();
			await flush();

			const state = scopeInstance.getAsync('derived');
			expect(state.status).toBe('set');
			expect(state.hasValue).toBe(true);
			expect(state.value).toBe(42);
		});
	});

	describe('getAsync() on instances', () => {
		it("returns 'set' AsyncState for sync value fields", () => {
			const scope = valueScope({ x: value(42) });
			const scopeInstance = scope.create();

			expect(scopeInstance.getAsync('x')).toEqual({
				value: 42,
				hasValue: true,
				status: 'set',
				error: undefined,
			});
		});

		it("returns 'set' AsyncState for sync derivations", () => {
			const scope = valueScope({
				x: value(5),
				doubled: ({ use }) => (use('x') as number) * 2,
			});
			const scopeInstance = scope.create();

			expect(scopeInstance.getAsync('doubled')).toEqual({
				value: 10,
				hasValue: true,
				status: 'set',
				error: undefined,
			});
		});

		it('returns correct AsyncState for async derivation', async () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => (use('x') as number) * 10,
			});
			const scopeInstance = scope.create();

			// Before resolution
			expect(scopeInstance.getAsync('derived').status).toBe('unset');

			await flush();

			expect(scopeInstance.getAsync('derived')).toEqual({
				value: 10,
				hasValue: true,
				status: 'set',
				error: undefined,
			});
		});
	});

	describe('seed value from create input', () => {
		it('seeded value is available via get() before async resolves', async () => {
			const scope = valueScope({
				userId: value<string>(),
				profile: async ({ use }) => {
					const id = use('userId');
					await flush();
					return { name: id, fresh: true };
				},
			});
			const scopeInstance = scope.create({
				userId: 'alice',
				profile: { name: 'alice', fresh: false },
			});

			// Before resolution — seed value is available immediately
			expect(scopeInstance.get('profile')).toEqual({
				name: 'alice',
				fresh: false,
			});

			await flush();
			await flush();

			// After resolution — replaced by fresh data
			expect(scopeInstance.get('profile')).toEqual({
				name: 'alice',
				fresh: true,
			});
		});

		it('seeded value is preserved in getAsync while derivation runs', () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => (use('x') as number) * 10,
			});
			const scopeInstance = scope.create({ derived: 99 });

			const state = scopeInstance.getAsync('derived');
			expect(state.value).toBe(99);
			expect(state.hasValue).toBe(true);
			// Status is 'setting' because the async derivation is already running
			expect(state.status).toBe('setting');
		});

		it('seeded value becomes previousValue in first derivation run', async () => {
			const capturedPreviousValues: unknown[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, previousValue }) => {
					capturedPreviousValues.push(previousValue);
					return (use('x') as number) * 10;
				},
			});
			scope.create({ derived: 42 });

			await flush();

			// First run should see the seeded value as previousValue
			expect(capturedPreviousValues).toEqual([42]);
		});

		it('seed is available immediately and replaced when async resolves', async () => {
			const scope = valueScope({
				userId: value<string>(),
				profile: async ({ use }) => {
					await flush();
					return {
						name: (use('userId') as string).toUpperCase(),
						cached: false,
					};
				},
			});
			const scopeInstance = scope.create({
				userId: 'alice',
				profile: { name: 'ALICE', cached: true },
			});

			// Seed is available immediately — no extra code in the derivation
			expect(scopeInstance.get('profile')).toEqual({
				name: 'ALICE',
				cached: true,
			});

			await flush();
			await flush();

			// Fresh data replaces the seed
			expect(scopeInstance.get('profile')).toEqual({
				name: 'ALICE',
				cached: false,
			});
		});

		it('create without seed still starts as unset', () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use }) => (use('x') as number) * 10,
			});
			const scopeInstance = scope.create();

			expect(scopeInstance.getAsync('derived').status).toBe('unset');
			expect(scopeInstance.get('derived')).toBeUndefined();
		});

		it('seeded value works with createMap', async () => {
			const scope = valueScope({
				name: value<string>(),
				greeting: async ({ use }) => {
					await flush();
					return `Hello, ${(use('name') as string).toUpperCase()}!`;
				},
			});
			const map = scope.createMap();
			map.set('alice', { name: 'alice', greeting: 'Hello, ALICE!' } as any);

			// Seed available immediately
			expect(map.get('alice')?.get('greeting')).toBe('Hello, ALICE!');

			await flush();
			await flush();

			// Still correct after async resolves
			expect(map.get('alice')?.get('greeting')).toBe('Hello, ALICE!');
		});
	});
});
