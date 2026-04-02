import { describe, it, expect, vi } from 'vitest';
import { value, valueScope } from '../index.js';

describe('beforeChange', () => {
	describe('catch-all form', () => {
		it('fires synchronously before the signal is written', () => {
			const order: string[] = [];
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					beforeChange: ({ changes }) => {
						order.push(`before:${[...changes.keys()].join(',')}`);
					},
					onChange: () => {
						order.push('after');
					},
				},
			);
			const instance = scope.create();
			instance.set('x', 42);
			// beforeChange is sync — fires immediately
			expect(order).toEqual(['before:x']);
			// value was written (not prevented)
			expect(instance.get('x')).toBe(42);
		});

		it('receives changes map with from/to', () => {
			let captured:
				| ReadonlyMap<string, { from: unknown; to: unknown }>
				| undefined;
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					beforeChange: ({ changes }) => {
						captured = changes;
					},
				},
			);
			const instance = scope.create();
			instance.set('x', 42);
			expect(captured).toBeInstanceOf(Map);
			expect(captured?.get('x')).toEqual({ key: 'x', from: 0, to: 42 });
		});

		it('prevent() with no args blocks all changes', () => {
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: ({ prevent }) => {
						prevent();
					},
				},
			);
			const instance = scope.create();
			instance.set({ x: 42, y: 99 });
			expect(instance.get('x')).toBe(0);
			expect(instance.get('y')).toBe(0);
		});

		it('prevent(...keys) blocks specific fields', () => {
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: ({ prevent }) => {
						prevent('x');
					},
				},
			);
			const instance = scope.create();
			instance.set({ x: 42, y: 99 });
			expect(instance.get('x')).toBe(0);
			expect(instance.get('y')).toBe(99);
		});

		it('prevent() can take multiple keys', () => {
			const scope = valueScope(
				{
					x: value<number>(0),
					y: value<number>(0),
					z: value<number>(0),
				},
				{
					beforeChange: ({ prevent }) => {
						prevent('x', 'z');
					},
				},
			);
			const instance = scope.create();
			instance.set({ x: 1, y: 2, z: 3 });
			expect(instance.get('x')).toBe(0);
			expect(instance.get('y')).toBe(2);
			expect(instance.get('z')).toBe(0);
		});

		it('does not fire when value is identical', () => {
			const beforeChange = vi.fn();
			const scope = valueScope({ x: value<number>(42) }, { beforeChange });
			const instance = scope.create();
			instance.set('x', 42);
			expect(beforeChange).not.toHaveBeenCalled();
		});

		it('prevented changes do not trigger onChange', async () => {
			const onChange = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					beforeChange: ({ prevent }) => {
						prevent();
					},
					onChange,
				},
			);
			const instance = scope.create();
			instance.set('x', 42);
			await Promise.resolve();
			expect(onChange).not.toHaveBeenCalled();
		});

		it('partially prevented changes still trigger onChange for survivors', async () => {
			let onChangeChanges: ReadonlyMap<string, unknown> | undefined;
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: ({ prevent }) => {
						prevent('x');
					},
					onChange: ({ changes }) => {
						onChangeChanges = changes;
					},
				},
			);
			const instance = scope.create();
			instance.set({ x: 42, y: 99 });
			await Promise.resolve();
			expect(onChangeChanges).toBeDefined();
			expect(onChangeChanges?.has('x')).toBe(false);
			expect(onChangeChanges?.has('y')).toBe(true);
		});

		it('receives get() to read current state', () => {
			let readValue: unknown;
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(10) },
				{
					beforeChange: ({ get }) => {
						readValue = get('y');
					},
				},
			);
			const instance = scope.create();
			instance.set('x', 42);
			expect(readValue).toBe(10);
		});

		it('conditional prevent based on changes and state', () => {
			const scope = valueScope(
				{ role: value<string>('user'), isAdmin: value<boolean>(false) },
				{
					beforeChange: ({ changes, prevent, get }) => {
						if (changes.has('role') && !get('isAdmin')) {
							prevent('role');
						}
					},
				},
			);
			const instance = scope.create();
			instance.set('role', 'admin');
			expect(instance.get('role')).toBe('user'); // prevented

			instance.set('isAdmin', true);
			instance.set('role', 'admin');
			expect(instance.get('role')).toBe('admin'); // allowed
		});
	});

	describe('per-field form', () => {
		it('fires for the specific field', () => {
			const emailHandler = vi.fn();
			const scope = valueScope(
				{ email: value<string>(''), name: value<string>('') },
				{
					beforeChange: {
						email: emailHandler,
					},
				},
			);
			const instance = scope.create();
			instance.set('name', 'Alice');
			expect(emailHandler).not.toHaveBeenCalled();

			instance.set('email', 'alice@test.com');
			expect(emailHandler).toHaveBeenCalledOnce();
		});

		it('receives from, to, prevent, get', () => {
			let captured: { from: unknown; to: unknown } | undefined;
			const scope = valueScope(
				{ email: value<string>('old@test.com') },
				{
					beforeChange: {
						email: ({ from, to }) => {
							captured = { from, to };
						},
					},
				},
			);
			const instance = scope.create();
			instance.set('email', 'new@test.com');
			expect(captured).toEqual({ from: 'old@test.com', to: 'new@test.com' });
		});

		it('prevent() blocks the field change', () => {
			const scope = valueScope(
				{ email: value<string>('') },
				{
					beforeChange: {
						email: ({ to, prevent }) => {
							if (!to.includes('@')) prevent();
						},
					},
				},
			);
			const instance = scope.create();
			instance.set('email', 'invalid');
			expect(instance.get('email')).toBe('');

			instance.set('email', 'valid@test.com');
			expect(instance.get('email')).toBe('valid@test.com');
		});
	});

	describe('bulk set batching', () => {
		it('batches multiple fields into one beforeChange call', () => {
			const beforeChange = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ beforeChange },
			);
			const instance = scope.create();
			instance.set({ x: 1, y: 2 });
			expect(beforeChange).toHaveBeenCalledOnce();
			const changes = beforeChange.mock.calls[0]![0].changes as Map<
				string,
				unknown
			>;
			expect(changes.size).toBe(2);
		});

		it('single-field set also goes through beforeChange', () => {
			const beforeChange = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { beforeChange });
			const instance = scope.create();
			instance.set('x', 1);
			expect(beforeChange).toHaveBeenCalledOnce();
		});
	});

	describe('interaction with setSnapshot', () => {
		it('setSnapshot triggers beforeChange', () => {
			const beforeChange = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ beforeChange },
			);
			const instance = scope.create();
			instance.setSnapshot({ x: 10, y: 20 });
			expect(beforeChange).toHaveBeenCalledOnce();
		});

		it('prevented fields survive in setSnapshot', () => {
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: ({ prevent }) => {
						prevent('x');
					},
				},
			);
			const instance = scope.create();
			instance.setSnapshot({ x: 10, y: 20 });
			expect(instance.get('x')).toBe(0);
			expect(instance.get('y')).toBe(20);
		});
	});

	describe('extend merging', () => {
		it('both base and extension beforeChange hooks fire', () => {
			const baseHook = vi.fn();
			const extHook = vi.fn();
			const base = valueScope(
				{ x: value<number>(0) },
				{ beforeChange: baseHook },
			);
			const extended = base.extend(
				{ y: value<number>(0) },
				{ beforeChange: extHook },
			);
			const instance = extended.create();
			instance.set('x', 1);
			expect(baseHook).toHaveBeenCalledOnce();
			expect(extHook).toHaveBeenCalledOnce();
		});

		it('extension can prevent what base allowed', () => {
			const base = valueScope(
				{ x: value<number>(0) },
				{
					beforeChange: () => {
						// base allows everything
					},
				},
			);
			const extended = base.extend(
				{},
				{
					beforeChange: ({ prevent }) => {
						prevent('x');
					},
				},
			);
			const instance = extended.create();
			instance.set('x', 42);
			expect(instance.get('x')).toBe(0);
		});
	});

	describe('does not re-enter', () => {
		it('set() inside beforeChange does not trigger another beforeChange', () => {
			const callCount = { value: 0 };
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: () => {
						callCount.value++;
					},
				},
			);
			const instance = scope.create();
			instance.set('x', 1);
			expect(callCount.value).toBe(1);
		});
	});

	describe('callback-style set', () => {
		it('resolves callback before passing to beforeChange', () => {
			let capturedTo: unknown;
			const scope = valueScope(
				{ x: value<number>(10) },
				{
					beforeChange: ({ changes }) => {
						capturedTo = changes.get('x')?.to;
					},
				},
			);
			const instance = scope.create();
			instance.set('x', (prev) => prev + 5);
			expect(capturedTo).toBe(15);
			expect(instance.get('x')).toBe(15);
		});
	});
});
