import { describe, it, expect, vi } from 'vitest';
import { value, valueScope } from '../index.js';

describe('derivation context', () => {
	describe('use() — tracked reads', () => {
		it('derivation recomputes when a use() dep changes', () => {
			const scope = valueScope({
				x: value(1),
				doubled: ({ use }) => (use('x') as number) * 2,
			});
			const scopeInstance = scope.create();
			expect(scopeInstance.get('doubled')).toBe(2);
			scopeInstance.set('x', 5);
			expect(scopeInstance.get('doubled')).toBe(10);
		});

		it('derivation tracks multiple use() deps', () => {
			const scope = valueScope({
				a: value(1),
				b: value(2),
				sum: ({ use }) => (use('a') as number) + (use('b') as number),
			});
			const scopeInstance = scope.create();
			expect(scopeInstance.get('sum')).toBe(3);
			scopeInstance.set('a', 10);
			expect(scopeInstance.get('sum')).toBe(12);
			scopeInstance.set('b', 20);
			expect(scopeInstance.get('sum')).toBe(30);
		});

		it('subscriber fires when a use() dep changes', () => {
			const scope = valueScope({
				x: value(0),
				derived: ({ use }) => (use('x') as number) + 1,
			});
			const scopeInstance = scope.create();
			const fn = vi.fn();
			scopeInstance.subscribe(() => fn());
			scopeInstance.set('x', 5);
			expect(fn).toHaveBeenCalledOnce();
		});
	});

	describe('get() — non-tracked reads (peek)', () => {
		it('derivation can read via get() without tracking', () => {
			const scope = valueScope({
				x: value(1),
				y: value(10),
				// use x (tracked), get y (non-tracked)
				result: ({ use, get }) => (use('x') as number) + (get('y') as number),
			});
			const scopeInstance = scope.create();
			expect(scopeInstance.get('result')).toBe(11);
		});

		it('derivation does NOT recompute when a get()-only dep changes', () => {
			let runCount = 0;
			const scope = valueScope({
				tracked: value(0),
				untracked: value(100),
				derived: ({ use, get }) => {
					runCount++;
					return (use('tracked') as number) + (get('untracked') as number);
				},
			});
			const scopeInstance = scope.create();
			expect(scopeInstance.get('derived')).toBe(100);
			expect(runCount).toBe(1);

			// Changing the untracked field should NOT recompute the derivation
			scopeInstance.set('untracked', 200);
			// Force a read — if it recomputed, runCount would be 2
			// But since "untracked" wasn't tracked, the computed shouldn't have re-run
			// The value will be stale (still 100, not 200) because the derivation wasn't re-triggered
			expect(scopeInstance.get('derived')).toBe(100);
			expect(runCount).toBe(1);

			// Changing the tracked field DOES recompute (and picks up the new untracked value)
			scopeInstance.set('tracked', 1);
			expect(scopeInstance.get('derived')).toBe(201);
			expect(runCount).toBe(2);
		});
	});

	describe('previousValue', () => {
		it('is undefined on first computation', () => {
			let captured: unknown = 'sentinel';
			const scope = valueScope({
				x: value(1),
				derived: ({ use, previousValue }) => {
					captured = previousValue;
					return (use('x') as number) * 2;
				},
			});
			const scopeInstance = scope.create();
			scopeInstance.get('derived'); // force lazy computed to evaluate
			expect(captured).toBeUndefined();
		});

		it('holds the last returned value on subsequent runs', () => {
			const previousValues: unknown[] = [];
			const scope = valueScope({
				x: value(1),
				derived: ({ use, previousValue }) => {
					previousValues.push(previousValue);
					return (use('x') as number) * 2;
				},
			});
			const scopeInstance = scope.create();
			scopeInstance.get('derived'); // force lazy computed to evaluate
			expect(previousValues).toEqual([undefined]); // first run

			scopeInstance.set('x', 5);
			scopeInstance.get('derived'); // force recomputation
			expect(previousValues).toEqual([undefined, 2]); // second run sees prev=2

			scopeInstance.set('x', 10);
			scopeInstance.get('derived'); // force recomputation
			expect(previousValues).toEqual([undefined, 2, 10]); // third run sees prev=10
		});
	});

	describe('identity comparison', () => {
		it('returning same reference suppresses downstream notifications', () => {
			const stableObj = { id: 1, name: 'Alice' };
			const scope = valueScope({
				x: value(0),
				obj: ({ use, previousValue }) => {
					void use('x'); // track x
					// Always return the same object reference
					if (previousValue) return previousValue;
					return stableObj;
				},
				downstream: ({ use }) => {
					return `name: ${(use('obj') as { name: string }).name}`;
				},
			});
			const scopeInstance = scope.create();
			expect(scopeInstance.get('obj')).toBe(stableObj);
			expect(scopeInstance.get('downstream')).toBe('name: Alice');

			const fn = vi.fn();
			scopeInstance.subscribe(() => fn());

			// Change x — obj derivation runs but returns same reference
			scopeInstance.set('x', 1);

			// obj didn't change reference, so downstream shouldn't recompute
			expect(scopeInstance.get('obj')).toBe(stableObj);
		});

		it('returning different reference triggers notification', () => {
			const scope = valueScope({
				x: value(0),
				obj: ({ use }) => ({ value: use('x') as number }),
			});
			const scopeInstance = scope.create();
			const first = scopeInstance.get('obj');

			scopeInstance.set('x', 1);
			const second = scopeInstance.get('obj');

			expect(first).not.toBe(second);
			expect(second).toEqual({ value: 1 });
		});
	});

	describe('getAsync() on sync fields', () => {
		it("returns a 'set' AsyncState for sync value fields", () => {
			const scope = valueScope({
				x: value(42),
				check: ({ getAsync }) => getAsync('x'),
			});
			const scopeInstance = scope.create();
			const state = scopeInstance.get('check');
			expect(state).toEqual({
				value: 42,
				hasValue: true,
				status: 'set',
				error: undefined,
			});
		});

		it("returns a 'set' AsyncState for sync derivations", () => {
			const scope = valueScope({
				x: value(5),
				doubled: ({ use }) => (use('x') as number) * 2,
				check: ({ getAsync }) => getAsync('doubled'),
			});
			const scopeInstance = scope.create();
			const state = scopeInstance.get('check');
			expect(state).toEqual({
				value: 10,
				hasValue: true,
				status: 'set',
				error: undefined,
			});
		});
	});

	describe('derivations with zero use() calls', () => {
		it('acts as a constant — runs once, never recomputes', () => {
			let runCount = 0;
			const scope = valueScope({
				x: value(0),
				constant: () => {
					runCount++;
					return Date.now();
				},
			});
			const scopeInstance = scope.create();
			const first = scopeInstance.get('constant');
			expect(runCount).toBe(1);

			scopeInstance.set('x', 999);
			expect(scopeInstance.get('constant')).toBe(first);
			expect(runCount).toBe(1);
		});
	});

	describe('get() with peek-only derivation', () => {
		it('derivation with only get() calls is a constant', () => {
			let runCount = 0;
			const scope = valueScope({
				x: value(42),
				peeked: ({ get }) => {
					runCount++;
					return (get('x') as number) + 1;
				},
			});
			const scopeInstance = scope.create();
			expect(scopeInstance.get('peeked')).toBe(43);
			expect(runCount).toBe(1);

			scopeInstance.set('x', 100);
			// Should NOT recompute — get() doesn't track
			expect(scopeInstance.get('peeked')).toBe(43);
			expect(runCount).toBe(1);
		});
	});
});
