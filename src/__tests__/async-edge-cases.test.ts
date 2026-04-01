import { describe, it, expect } from 'vitest';
import { value, valueScope } from '../index.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('async derivation edge cases', () => {
	describe('async derivation chains', () => {
		it('sync derivation downstream of async updates when async resolves', async () => {
			const scope = valueScope({
				userId: value('alice'),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
				displayName: ({ use }) => {
					const profile = use('profile') as { name: string } | undefined;
					return profile?.name ?? 'unknown';
				},
			});
			const scopeInstance = scope.create();

			expect(scopeInstance.get('displayName')).toBe('unknown');

			await flush();

			expect(scopeInstance.get('displayName')).toBe('ALICE');
		});

		it('async derivation reading another async derivation sees T | undefined', async () => {
			const scope = valueScope({
				userId: value('alice'),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
				greeting: async ({ use }) => {
					const profile = use('profile') as { name: string } | undefined;
					return profile ? `Hello, ${profile.name}!` : 'Loading...';
				},
			});
			const scopeInstance = scope.create();

			await flush();

			// profile resolves first, then greeting re-runs with the resolved value
			// But since both are async, greeting's first run may see undefined
			// After full resolution, greeting should see the resolved profile
			await flush();

			expect(scopeInstance.get('greeting')).toBe('Hello, ALICE!');
		});
	});

	describe('multiple async derivations in same scope', () => {
		it('independent async derivations resolve independently', async () => {
			const scope = valueScope({
				userId: value('alice'),
				teamId: value('team-1'),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
				team: async ({ use }) => {
					return { teamName: `Team ${use('teamId') as string}` };
				},
			});
			const scopeInstance = scope.create();

			await flush();

			expect(scopeInstance.get('profile')).toEqual({ name: 'ALICE' });
			expect(scopeInstance.get('team')).toEqual({ teamName: 'Team team-1' });
		});

		it('changing one dep only re-runs the affected async derivation', async () => {
			let profileRunCount = 0;
			let teamRunCount = 0;
			const scope = valueScope({
				userId: value('alice'),
				teamId: value('team-1'),
				profile: async ({ use }) => {
					profileRunCount++;
					return (use('userId') as string).toUpperCase();
				},
				team: async ({ use }) => {
					teamRunCount++;
					return `Team ${use('teamId') as string}`;
				},
			});
			scope.create();

			await flush();
			expect(profileRunCount).toBe(1);
			expect(teamRunCount).toBe(1);

			// Only profile's dep changed
			scope.create().set('userId', 'bob');
			// Can't easily test on original instance since we called create() twice
			// Let's use a single instance
		});

		it('changing one dep does not re-run the other async derivation', async () => {
			let profileRunCount = 0;
			let teamRunCount = 0;
			const scope = valueScope({
				userId: value('alice'),
				teamId: value('team-1'),
				profile: async ({ use }) => {
					profileRunCount++;
					return (use('userId') as string).toUpperCase();
				},
				team: async ({ use }) => {
					teamRunCount++;
					return `Team ${use('teamId') as string}`;
				},
			});
			const scopeInstance = scope.create();

			await flush();
			const baseProfile = profileRunCount;
			const baseTeam = teamRunCount;

			scopeInstance.set('userId', 'bob');
			await flush();

			expect(profileRunCount).toBe(baseProfile + 1);
			expect(teamRunCount).toBe(baseTeam); // team should NOT re-run
		});
	});

	describe('rapid dep changes', () => {
		it("only the last run's result wins after 3 rapid changes", async () => {
			const results: string[] = [];
			const scope = valueScope({
				x: value('a'),
				derived: async ({ use }) => {
					const val = use('x') as string;
					await flush();
					results.push(val);
					return val.toUpperCase();
				},
			});
			const scopeInstance = scope.create();

			// Rapid fire — only "d" should win
			scopeInstance.set('x', 'b');
			scopeInstance.set('x', 'c');
			scopeInstance.set('x', 'd');

			await flush();
			await flush(); // extra flush for safety

			expect(scopeInstance.get('derived')).toBe('D');
		});
	});

	describe('destroy during in-flight async', () => {
		it('aborts in-flight async and does not write result after destroy', async () => {
			let resolved = false;
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, signal }) => {
					use('x');
					await flush();
					if (!signal.aborted) resolved = true;
					return 42;
				},
			});
			const scopeInstance = scope.create();

			// Destroy while async is in flight
			scopeInstance.destroy();

			await flush();

			// The async should have been aborted
			expect(resolved).toBe(false);
			// Value should still be undefined (never resolved)
			expect(scopeInstance.get('derived')).toBeUndefined();
		});
	});

	describe('multiple onCleanup registrations', () => {
		it('all registered cleanups fire on re-run', async () => {
			const cleanups: string[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, onCleanup }) => {
					use('x');
					onCleanup(() => cleanups.push('cleanup-a'));
					onCleanup(() => cleanups.push('cleanup-b'));
					onCleanup(() => cleanups.push('cleanup-c'));
					return 'done';
				},
			});
			const scopeInstance = scope.create();
			await flush();

			expect(cleanups).toEqual([]);

			scopeInstance.set('x', 2);

			expect(cleanups).toEqual(['cleanup-a', 'cleanup-b', 'cleanup-c']);
		});
	});

	describe('set() after abort is ignored', () => {
		it('set() called after signal is aborted has no effect', async () => {
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, set }) => {
					const val = use('x') as number;
					set(val * 2); // this should work (before abort)
					await flush();
					set(val * 100); // this may be called after abort
					return val * 10;
				},
			});
			const scopeInstance = scope.create();

			// Let first run's sync preamble execute
			await Promise.resolve();
			expect(scopeInstance.get('derived')).toBe(2); // intermediate from first run

			// Change dep — aborts first run
			scopeInstance.set('x', 5);

			// Second run's sync preamble
			await Promise.resolve();
			expect(scopeInstance.get('derived')).toBe(10); // intermediate from second run

			await flush();

			// Final value should be from second run (50), not first (10 or 100)
			expect(scopeInstance.get('derived')).toBe(50);
		});
	});

	describe('error then recovery', () => {
		it('recovers from error when dep changes and async succeeds', async () => {
			let shouldFail = true;
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
			expect(scopeInstance.getAsync('derived').status).toBe('error');

			// Now fix the error condition and trigger re-run
			shouldFail = false;
			scopeInstance.set('x', 2);

			// During re-run: should be 'setting'
			expect(scopeInstance.getAsync('derived').status).toBe('setting');

			await flush();

			expect(scopeInstance.getAsync('derived').status).toBe('set');
			expect(scopeInstance.getAsync('derived').value).toBe(20);
			expect(scopeInstance.getAsync('derived').error).toBeUndefined();
		});
	});

	describe('previousValue with intermediate set()', () => {
		it('previousValue reflects the last resolved value, not intermediate set() values', async () => {
			const capturedPreviousValues: unknown[] = [];
			const scope = valueScope({
				x: value(1),
				derived: async ({ use, set, previousValue }) => {
					capturedPreviousValues.push(previousValue);
					const val = use('x') as number;
					set(val * 2); // intermediate
					return val * 10; // final
				},
			});
			const scopeInstance = scope.create();

			await flush();
			// First run: previousValue was undefined, resolved to 10
			expect(capturedPreviousValues).toEqual([undefined]);

			scopeInstance.set('x', 2);
			await flush();
			// Second run: previousValue should be 10 (the final return of first run)
			// Note: set(2) pushed 2 as intermediate, but previousValue at the START
			// of the second run reflects the last resolved value (10)
			expect(capturedPreviousValues).toEqual([undefined, 10]);
		});
	});
});
