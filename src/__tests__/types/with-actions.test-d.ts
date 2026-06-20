import { expectTypeOf } from 'expect-type';
import { value, type Value } from '../../core/value.js';
import { valueScope, type ScopeTemplate } from '../../core/value-scope.js';
import { withActions } from '../../middleware/actions.js';
import { withHistory } from '../../middleware/history.js';

const counter = valueScope(
	{ count: value(0), status: value<'idle' | 'busy'>('idle') },
	{ doubled: ({ scope }) => scope.count.use() * 2 },
);

// ── Actions land typed; the `{ scope, signal }` ctx type-checks ──────

const wc = withActions(counter, {
	increment:
		({ scope }) =>
		(by: number) =>
			scope.count.set(scope.count.get() + by),
	reset:
		({ scope }) =>
		() => {
			scope.count.set(0);
			scope.status.set('idle');
		},
	load:
		({ scope, signal, onCleanup }) =>
		async () => {
			scope.status.set('busy');
			onCleanup(() => scope.status.set('idle'));
			await Promise.resolve();
			if (signal.aborted) return;
			scope.count.set(1);
		},
});

const c = wc.create({ count: 5 });
expectTypeOf(c.increment).toEqualTypeOf<(by: number) => void>();
expectTypeOf(c.reset).toEqualTypeOf<() => void>();
expectTypeOf(c.load).toEqualTypeOf<() => Promise<void>>();
expectTypeOf(c.count.get()).toEqualTypeOf<number>();
expectTypeOf(c.doubled.get()).toEqualTypeOf<number>();
expectTypeOf(c.$getSnapshot).toBeFunction();

// ── Composition with real withHistory preserves both surfaces ────────

const stacked = withActions(withHistory(counter), {
	bump:
		({ scope }) =>
		() => {
			scope.$undo(); // history augmentation visible inside actions
			scope.count.set(scope.count.get() + 1);
		},
});
const s = stacked.create();
expectTypeOf(s.bump).toEqualTypeOf<() => void>();
expectTypeOf(s.$undo).toEqualTypeOf<() => void>();
expectTypeOf(s.$canUndo).toEqualTypeOf<boolean>();
expectTypeOf(s.count.get()).toEqualTypeOf<number>();

// ── createMap carries the actions through ────────────────────────────

const m = wc.createMap();
expectTypeOf(m.get(1)!.increment).toEqualTypeOf<(by: number) => void>();

// ── Sibling typing via LAYERS — 3 layers, layer 3 calls layers 1 & 2 ──

const layered = withActions(
	counter,
	{
		increment:
			({ scope }) =>
			(by: number) =>
				scope.count.set(scope.count.get() + by),
	},
	{
		label:
			({ scope }) =>
			(): string =>
				`count=${scope.count.get()}`,
		reset:
			({ scope }) =>
			() =>
				scope.increment(-scope.count.get()), // sees layer 1
	},
	{
		describe:
			({ scope }) =>
			(): string => {
				scope.increment(1); // layer 1
				return scope.label(); // layer 2
			},
	},
);
const lz = layered.create();
expectTypeOf(lz.increment).toEqualTypeOf<(by: number) => void>();
expectTypeOf(lz.label).toEqualTypeOf<() => string>();
expectTypeOf(lz.reset).toEqualTypeOf<() => void>();
expectTypeOf(lz.describe).toEqualTypeOf<() => string>();

// ── Full 11-layer ceiling: each layer calls the previous; layer 11
//    reaches back to layer 1, with a non-void return. ──

const big = withActions(
	counter,
	{
		a1:
			({ scope }) =>
			() =>
				scope.count.set(1),
	},
	{
		a2:
			({ scope }) =>
			() =>
				scope.a1(),
	},
	{
		a3:
			({ scope }) =>
			() =>
				scope.a2(),
	},
	{
		a4:
			({ scope }) =>
			() =>
				scope.a3(),
	},
	{
		a5:
			({ scope }) =>
			() =>
				scope.a4(),
	},
	{
		a6:
			({ scope }) =>
			() =>
				scope.a5(),
	},
	{
		a7:
			({ scope }) =>
			() =>
				scope.a6(),
	},
	{
		a8:
			({ scope }) =>
			() =>
				scope.a7(),
	},
	{
		a9:
			({ scope }) =>
			() =>
				scope.a8(),
	},
	{
		a10:
			({ scope }) =>
			() =>
				scope.a9(),
	},
	{
		a11:
			({ scope }) =>
			(): number => {
				scope.a10();
				scope.a1();
				return scope.count.get();
			},
	},
);
const bg = big.create();
expectTypeOf(bg.a1).toEqualTypeOf<() => void>();
expectTypeOf(bg.a10).toEqualTypeOf<() => void>();
expectTypeOf(bg.a11).toEqualTypeOf<() => number>();

// ── NEGATIVE: a same-layer sibling is not visible on scope ───────────

withActions(counter, {
	first:
		({ scope }) =>
		() =>
			scope.count.set(0),
	second:
		({ scope }) =>
		() =>
			// @ts-expect-error — `first` is in the same layer, not yet on scope
			scope.first(),
});

// ── Inference from a BARE ScopeTemplate input (not a concrete literal) ─

declare const plain: ScopeTemplate<{ count: Value<number> }>;
const fromPlain = withActions(plain, {
	inc:
		({ scope }) =>
		() =>
			scope.count.set(scope.count.get() + 1),
});
const fp = fromPlain.create();
expectTypeOf(fp.inc).toEqualTypeOf<() => void>();
expectTypeOf(fp.count.get()).toEqualTypeOf<number>();
