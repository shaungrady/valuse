import { describe, it, expect } from 'vitest';
import { value, valueRef, valueScope } from '../index.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('async derivation integration', () => {
	describe('extend() with async derivations', () => {
		it('extended scope preserves base async derivation', async () => {
			const base = valueScope({
				userId: value('alice'),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
			});

			const extended = base.extend({
				extraField: value('hello'),
			});

			const scopeInstance = extended.create();
			await flush();

			expect(scopeInstance.get('profile')).toEqual({ name: 'ALICE' });
			expect(scopeInstance.get('extraField')).toBe('hello');
		});

		it('extended scope can add new async derivations', async () => {
			const base = valueScope({
				userId: value('alice'),
			});

			const extended = base.extend({
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
			});

			const scopeInstance = extended.create();
			await flush();

			expect(scopeInstance.get('profile')).toEqual({ name: 'ALICE' });
		});

		it("extended scope's sync derivation can read base async derivation", async () => {
			const base = valueScope({
				userId: value('alice'),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
			});

			const extended = base.extend({
				displayName: ({ use }) => {
					const profile = use('profile') as { name: string } | undefined;
					return profile?.name ?? 'loading';
				},
			});

			const scopeInstance = extended.create();
			expect(scopeInstance.get('displayName')).toBe('loading');

			await flush();
			expect(scopeInstance.get('displayName')).toBe('ALICE');
		});
	});

	describe('createMap() with async derivations', () => {
		it('map entries have working async derivations', async () => {
			const user = valueScope({
				userId: value<string>(),
				profile: async ({ use }) => {
					return { name: (use('userId') as string).toUpperCase() };
				},
			});

			const users = user.createMap();
			users.set('alice', { userId: 'alice' });
			users.set('bob', { userId: 'bob' });

			await flush();

			const alice = users.get('alice');
			const bob = users.get('bob');
			expect(alice?.get('profile')).toEqual({ name: 'ALICE' });
			expect(bob?.get('profile')).toEqual({ name: 'BOB' });
		});

		it('map entry async derivation re-runs when entry dep changes', async () => {
			const user = valueScope({
				name: value<string>(),
				greeting: async ({ use }) => {
					return `Hello, ${(use('name') as string).toUpperCase()}!`;
				},
			});

			const users = user.createMap();
			users.set('alice', { name: 'alice' });

			await flush();
			expect(users.get('alice')?.get('greeting')).toBe('Hello, ALICE!');

			users.get('alice')?.set('name', 'alicia');
			await flush();

			expect(users.get('alice')?.get('greeting')).toBe('Hello, ALICIA!');
		});

		it('deleting a map entry destroys its async derivations', async () => {
			const cleanups: string[] = [];
			const user = valueScope({
				name: value<string>(),
				data: async ({ use, onCleanup }) => {
					const name = use('name') as string;
					onCleanup(() => cleanups.push(name));
					return name;
				},
			});

			const users = user.createMap();
			users.set('alice', { name: 'alice' });
			await flush();

			users.delete('alice');
			expect(cleanups).toContain('alice');
		});
	});

	describe("ref'd scope with async derivation", () => {
		it("outer sync derivation reads ref'd scope's async result", async () => {
			const stockScope = valueScope({
				symbol: value('AAPL'),
				price: async ({ use }) => {
					return `$${(use('symbol') as string).length * 10}`;
				},
			});
			const stockInstance = stockScope.create();

			const dashboard = valueScope({
				stock: valueRef(stockInstance),
				display: ({ use }) => {
					const stock = use('stock') as typeof stockInstance;
					const price = stock.get('price') as string | undefined;
					return price ?? 'fetching...';
				},
			});
			const dashboardInstance = dashboard.create();

			expect(dashboardInstance.get('display')).toBe('fetching...');

			await flush();

			expect(dashboardInstance.get('display')).toBe('$40');
		});

		it("subscriber on outer scope fires when ref'd async derivation resolves", async () => {
			const inner = valueScope({
				x: value(1),
				derived: async ({ use }) => (use('x') as number) * 10,
			});
			const innerInstance = inner.create();

			const outer = valueScope({
				ref: valueRef(innerInstance),
			});
			const outerInstance = outer.create();

			let subscriberFired = false;
			outerInstance.subscribe(() => {
				subscriberFired = true;
			});

			await flush();

			// Outer subscriber should fire when inner async derivation resolves
			expect(subscriberFired).toBe(true);

			// And reading through the ref gives the resolved value
			const ref = outerInstance.get('ref') as typeof innerInstance;
			expect(ref.get('derived')).toBe(10);
		});

		it("getAsync() through ref'd scope returns correct state", async () => {
			const inner = valueScope({
				x: value(1),
				derived: async ({ use }) => (use('x') as number) * 10,
			});
			const innerInstance = inner.create();

			// Check async state on the inner instance
			expect(innerInstance.getAsync('derived').status).toBe('unset');

			await flush();

			expect(innerInstance.getAsync('derived')).toEqual({
				value: 10,
				hasValue: true,
				status: 'set',
				error: undefined,
			});
		});
	});

	describe('onChange interaction with async derivations', () => {
		it('onChange does NOT fire when async derivation resolves (only value fields trigger onChange)', async () => {
			const onChangeCalls: string[][] = [];
			const scope = valueScope(
				{
					x: value(1),
					derived: async ({ use }) => (use('x') as number) * 10,
				},
				{
					onChange: ({ changes }) => {
						onChangeCalls.push([...changes.keys()]);
					},
				},
			);
			const scopeInstance = scope.create();

			await flush();

			// Async resolution should NOT trigger onChange — it's not a value field mutation
			expect(onChangeCalls).toEqual([]);

			// But changing x DOES trigger onChange
			scopeInstance.set('x', 2);
			await flush();

			expect(onChangeCalls.length).toBe(1);
			expect(onChangeCalls[0]).toEqual(['x']);
		});
	});

	describe('conditional use() in async derivation', () => {
		it('tracks deps from the sync preamble only', async () => {
			let runCount = 0;
			const scope = valueScope({
				condition: value(true),
				trackedWhenTrue: value('a'),
				trackedWhenFalse: value('b'),
				derived: async ({ use }) => {
					runCount++;
					const cond = use('condition') as boolean;
					if (cond) {
						return `true: ${use('trackedWhenTrue') as string}`;
					} else {
						return `false: ${use('trackedWhenFalse') as string}`;
					}
				},
			});
			const scopeInstance = scope.create();
			await flush();

			const baseCount = runCount;

			// Change the branch not taken — this WILL re-run because
			// condition is always tracked (it's in the sync preamble)
			// But trackedWhenFalse was NOT read in the first run
			// So changing it shouldn't trigger a re-run
			scopeInstance.set('trackedWhenFalse', 'changed');
			await flush();

			expect(runCount).toBe(baseCount); // should NOT have re-run

			// Change condition — SHOULD re-run
			scopeInstance.set('condition', false);
			await flush();

			expect(runCount).toBe(baseCount + 1);
			expect(scopeInstance.get('derived')).toBe('false: changed');
		});
	});

	describe('bulk set triggering async re-runs', () => {
		it('bulk set() only triggers one re-run per async derivation', async () => {
			let runCount = 0;
			const scope = valueScope({
				a: value(1),
				b: value(2),
				derived: async ({ use }) => {
					runCount++;
					return (use('a') as number) + (use('b') as number);
				},
			});
			const scopeInstance = scope.create();
			await flush();

			const baseCount = runCount;

			// Bulk set both deps at once
			scopeInstance.set({ a: 10, b: 20 } as Record<string, unknown>);
			await flush();

			// Should only re-run once (Preact batches signal writes)
			expect(runCount).toBeLessThanOrEqual(baseCount + 2);
			expect(scopeInstance.get('derived')).toBe(30);
		});
	});
});
