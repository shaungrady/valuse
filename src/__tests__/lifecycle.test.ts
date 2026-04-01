import { describe, it, expect, vi } from 'vitest';
import { value, valueScope } from '../index.js';

describe('lifecycle hooks', () => {
	describe('onInit', () => {
		it('runs once when instance is created', () => {
			const onInit = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onInit });
			scope.create();
			expect(onInit).toHaveBeenCalledOnce();
		});

		it('receives { set, get, input }', () => {
			const scope = valueScope(
				{
					val: value<string>(),
					initialValue: value<string>(),
				},
				{
					onInit: ({ set, get, input }) => {
						set('initialValue', get('val'));
						expect(input).toEqual({ val: 'hello' });
					},
				},
			);
			const inst = scope.create({ val: 'hello' });
			expect(inst.get('initialValue')).toBe('hello');
		});
	});

	describe('onChange', () => {
		it('fires after a value mutation', async () => {
			const onChange = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onChange });
			const inst = scope.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(onChange).toHaveBeenCalledOnce();
		});

		it('receives { changes, set, get, getSnapshot }', async () => {
			let captured: unknown[] = [];
			let gotValue: unknown;
			let snapshot: unknown;
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(10) },
				{
					onChange: ({ changes, get, getSnapshot }) => {
						captured = changes;
						gotValue = get('y');
						snapshot = getSnapshot();
					},
				},
			);
			const inst = scope.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(captured).toEqual([{ key: 'x', from: 0, to: 42 }]);
			expect(gotValue).toBe(10);
			expect(snapshot).toEqual({ x: 42, y: 10 });
		});

		it('batches multiple synchronous changes', async () => {
			const onChange = vi.fn();
			const scope = valueScope(
				{
					x: value<number>(0),
					y: value<number>(0),
				},
				{ onChange },
			);
			const inst = scope.create();
			inst.set('x', 1);
			inst.set('y', 2);
			await Promise.resolve();
			expect(onChange).toHaveBeenCalledOnce();
			expect(onChange.mock.calls[0]?.[0].changes).toHaveLength(2);
		});

		it('sets inside onChange do not re-trigger', async () => {
			const onChange = vi.fn();
			const scope = valueScope(
				{
					x: value<number>(0),
					lastUpdated: value<number>(0),
				},
				{
					onChange: ({ set }) => {
						onChange();
						set('lastUpdated', Date.now());
					},
				},
			);
			const inst = scope.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(onChange).toHaveBeenCalledOnce();
			expect(inst.get('lastUpdated')).toBeGreaterThan(0);
		});
	});

	describe('onDestroy', () => {
		it('fires when destroy() is called', () => {
			const onDestroy = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onDestroy });
			const inst = scope.create();
			inst.destroy();
			expect(onDestroy).toHaveBeenCalledOnce();
		});

		it('receives { get }', () => {
			const scope = valueScope(
				{ x: value<number>(42) },
				{
					onDestroy: ({ get }) => {
						expect(get('x')).toBe(42);
					},
				},
			);
			const inst = scope.create();
			inst.destroy();
		});
	});

	describe('onUsed / onUnused', () => {
		it('onUsed fires when first subscriber attaches', () => {
			const onUsed = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onUsed });
			const inst = scope.create();
			inst.subscribe(() => {});
			expect(onUsed).toHaveBeenCalledOnce();
		});

		it('onUnused fires when last subscriber detaches', () => {
			const onUnused = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onUnused });
			const inst = scope.create();
			const unsub = inst.subscribe(() => {});
			expect(onUnused).not.toHaveBeenCalled();
			unsub();
			expect(onUnused).toHaveBeenCalledOnce();
		});

		it('onUsed does not fire on second subscriber', () => {
			const onUsed = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onUsed });
			const inst = scope.create();
			inst.subscribe(() => {});
			inst.subscribe(() => {});
			expect(onUsed).toHaveBeenCalledOnce();
		});

		it('onUnused does not fire until all subscribers detach', () => {
			const onUnused = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onUnused });
			const inst = scope.create();
			const unsub1 = inst.subscribe(() => {});
			const unsub2 = inst.subscribe(() => {});
			unsub1();
			expect(onUnused).not.toHaveBeenCalled();
			unsub2();
			expect(onUnused).toHaveBeenCalledOnce();
		});
	});
});
