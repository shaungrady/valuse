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
			let captured: unknown;
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
			expect(captured).toBeInstanceOf(Map);
			expect((captured as Map<string, unknown>).get('x')).toEqual({
				key: 'x',
				from: 0,
				to: 42,
			});
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
			expect(onChange.mock.calls[0]?.[0].changes.size).toBe(2);
		});

		it('collapses multiple changes to the same key', async () => {
			let captured: Map<string, { key: string; from: number; to: number }>;
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					onChange: ({ changes }) => {
						captured = changes as unknown as typeof captured;
					},
				},
			);
			const inst = scope.create();
			inst.set('x', 1);
			inst.set('x', 2);
			inst.set('x', 3);
			await Promise.resolve();
			expect(captured!.size).toBe(1);
			expect(captured!.get('x')).toEqual({ key: 'x', from: 0, to: 3 });
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

	describe('onChange (per-field object form)', () => {
		it('fires the handler for the changed field', async () => {
			const xHandler = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange: { x: xHandler } },
			);
			const inst = scope.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(xHandler).toHaveBeenCalledOnce();
			expect(xHandler.mock.calls[0]?.[0].from).toBe(0);
			expect(xHandler.mock.calls[0]?.[0].to).toBe(42);
		});

		it('does not fire handler for unrelated fields', async () => {
			const xHandler = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange: { x: xHandler } },
			);
			const inst = scope.create();
			inst.set('y', 99);
			await Promise.resolve();
			expect(xHandler).not.toHaveBeenCalled();
		});

		it('provides get and set in handler context', async () => {
			let captured: unknown;
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(10) },
				{
					onChange: {
						x: ({ to, get }) => {
							captured = { to, y: get('y') };
						},
					},
				},
			);
			const inst = scope.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(captured).toEqual({ to: 42, y: 10 });
		});

		it('fires multiple per-field handlers for batched changes', async () => {
			const xHandler = vi.fn();
			const yHandler = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange: { x: xHandler, y: yHandler } },
			);
			const inst = scope.create();
			inst.set('x', 1);
			inst.set('y', 2);
			await Promise.resolve();
			expect(xHandler).toHaveBeenCalledOnce();
			expect(yHandler).toHaveBeenCalledOnce();
		});

		it('set inside per-field handler does not re-trigger', async () => {
			const xHandler = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), lastUpdated: value<number>(0) },
				{
					onChange: {
						x: ({ set }) => {
							xHandler();
							set('lastUpdated', Date.now());
						},
					},
				},
			);
			const inst = scope.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(xHandler).toHaveBeenCalledOnce();
			expect(inst.get('lastUpdated')).toBeGreaterThan(0);
		});
	});

	describe('onChange extend() merging', () => {
		it('merges function form base with object form extension', async () => {
			const baseFn = vi.fn();
			const extHandler = vi.fn();
			const base = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange: baseFn },
			);
			const extended = base.extend({}, { onChange: { x: extHandler } });
			const inst = extended.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(baseFn).toHaveBeenCalledOnce();
			expect(extHandler).toHaveBeenCalledOnce();
			expect(extHandler.mock.calls[0]?.[0].to).toBe(42);
		});

		it('merges object form base with function form extension', async () => {
			const baseHandler = vi.fn();
			const extFn = vi.fn();
			const base = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange: { x: baseHandler } },
			);
			const extended = base.extend({}, { onChange: extFn });
			const inst = extended.create();
			inst.set('x', 42);
			await Promise.resolve();
			expect(baseHandler).toHaveBeenCalledOnce();
			expect(extFn).toHaveBeenCalledOnce();
		});

		it('batched changes only fire matching per-field handlers', async () => {
			const xHandler = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange: { x: xHandler } },
			);
			const inst = scope.create();
			inst.set('x', 1);
			inst.set('y', 2);
			await Promise.resolve();
			// x handler fires, y has no handler — silently ignored
			expect(xHandler).toHaveBeenCalledOnce();
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
