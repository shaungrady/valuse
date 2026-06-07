import { describe, it, expect, vi } from 'vitest';
import { fireOnCreate, wireLifecycleHooks } from '../core/scope-lifecycle.js';
import type { InstanceStore } from '../core/instance-store.js';
import type { ScopeConfig } from '../core/scope-config.js';

// wireLifecycleHooks only touches these four settable hook fields on the
// store, so a minimal fake is enough to exercise its wiring in isolation —
// no real signal graph or instance tree required.
function fakeStore(): InstanceStore {
	return {
		onChangeHook: null,
		beforeChangeHook: null,
		onUsedHook: null,
		onUnusedHook: null,
	} as unknown as InstanceStore;
}

// Call a store hook field without leaking `any` into every test.
const invoke = (hook: unknown, arg?: unknown): void => {
	(hook as (a?: unknown) => void)(arg);
};

const asConfig = (c: Record<string, unknown>): ScopeConfig =>
	c as unknown as ScopeConfig;

describe('fireOnCreate', () => {
	it('pushes exactly one cleanup (the abort) when there is no onCreate hook', () => {
		const cleanups: (() => void)[] = [];
		fireOnCreate(undefined, {}, undefined, cleanups);
		expect(cleanups).toHaveLength(1);
	});

	it('invokes onCreate with scope, input, a live signal, and onCleanup', () => {
		const cleanups: (() => void)[] = [];
		const instance = {};
		const input = { a: 1 };
		const onCreate = vi.fn();

		fireOnCreate(asConfig({ onCreate }), instance, input, cleanups);

		expect(onCreate).toHaveBeenCalledOnce();
		const ctx = onCreate.mock.calls[0]![0] as {
			scope: unknown;
			input: unknown;
			signal: AbortSignal;
			onCleanup: (fn: () => void) => void;
		};
		expect(ctx.scope).toBe(instance);
		expect(ctx.input).toBe(input);
		expect(ctx.signal).toBeInstanceOf(AbortSignal);
		expect(ctx.signal.aborted).toBe(false);

		// onCleanup appends to the same list (alongside the abort cleanup).
		const userCleanup = vi.fn();
		ctx.onCleanup(userCleanup);
		expect(cleanups).toHaveLength(2);
	});

	it('aborts the onCreate signal when the abort cleanup runs', () => {
		const cleanups: (() => void)[] = [];
		let signal!: AbortSignal;
		fireOnCreate(
			asConfig({
				onCreate: (ctx: { signal: AbortSignal }) => (signal = ctx.signal),
			}),
			{},
			undefined,
			cleanups,
		);
		expect(signal.aborted).toBe(false);
		cleanups[0]!(); // the abort cleanup is pushed first
		expect(signal.aborted).toBe(true);
	});
});

describe('wireLifecycleHooks', () => {
	it('wires onChange and beforeChange straight through to the store', () => {
		const store = fakeStore();
		const onChange = vi.fn();
		const beforeChange = vi.fn();
		wireLifecycleHooks(store, {}, asConfig({ onChange, beforeChange }), [], []);

		const changeCtx = { tag: 'change' };
		const beforeCtx = { tag: 'before' };
		invoke(store.onChangeHook, changeCtx);
		invoke(store.beforeChangeHook, beforeCtx);

		expect(onChange).toHaveBeenCalledWith(changeCtx);
		expect(beforeChange).toHaveBeenCalledWith(beforeCtx);
	});

	it('runs the onUsed/onUnused cycle: signal, cleanup, and onUnused callback', () => {
		const store = fakeStore();
		const usedCleanup = vi.fn();
		let signal!: AbortSignal;
		const onUsed = vi.fn(
			(ctx: { signal: AbortSignal; onCleanup: (f: () => void) => void }) => {
				signal = ctx.signal;
				ctx.onCleanup(usedCleanup);
			},
		);
		const onUnused = vi.fn();

		wireLifecycleHooks(store, {}, asConfig({ onUsed, onUnused }), [], []);

		invoke(store.onUsedHook);
		expect(onUsed).toHaveBeenCalledOnce();
		expect(signal.aborted).toBe(false);

		invoke(store.onUnusedHook);
		expect(usedCleanup).toHaveBeenCalledOnce();
		expect(signal.aborted).toBe(true);
		expect(onUnused).toHaveBeenCalledOnce();
	});

	it('runs onUsed cleanups + aborts on $destroy (instance cleanup)', () => {
		const store = fakeStore();
		const usedCleanup = vi.fn();
		const instanceCleanups: (() => void)[] = [];
		wireLifecycleHooks(
			store,
			{},
			asConfig({
				onUsed: (ctx: { onCleanup: (f: () => void) => void }) =>
					ctx.onCleanup(usedCleanup),
			}),
			[],
			instanceCleanups,
		);

		invoke(store.onUsedHook);
		// Simulate $destroy: instance cleanups run (onUnusedHook is NOT called).
		for (const c of instanceCleanups) c();
		expect(usedCleanup).toHaveBeenCalledOnce();
	});

	describe('transitive lifecycle refs', () => {
		it('subscribes to each ref on used and unsubscribes on unused', () => {
			const store = fakeStore();
			const unsub = vi.fn();
			const child = { $subscribe: vi.fn(() => unsub) };
			wireLifecycleHooks(store, {}, undefined, [child], []);

			invoke(store.onUsedHook);
			expect(child.$subscribe).toHaveBeenCalledOnce();
			expect(unsub).not.toHaveBeenCalled();

			invoke(store.onUnusedHook);
			expect(unsub).toHaveBeenCalledOnce();
		});

		it('releases child subscriptions on $destroy even without onUnused (leak guard)', () => {
			const store = fakeStore();
			const unsub = vi.fn();
			const child = { $subscribe: vi.fn(() => unsub) };
			const instanceCleanups: (() => void)[] = [];
			wireLifecycleHooks(store, {}, undefined, [child], instanceCleanups);

			invoke(store.onUsedHook); // parent gains a subscriber → child subscribed
			// Parent destroyed while still subscribed: store.destroy() never calls
			// onUnusedHook, so the instance cleanup must release the child.
			for (const c of instanceCleanups) c();
			expect(unsub).toHaveBeenCalledOnce();
		});

		it('preserves a pre-existing onUsed/onUnused alongside transitive wiring', () => {
			const store = fakeStore();
			const onUsed = vi.fn();
			const onUnused = vi.fn();
			const unsub = vi.fn();
			const child = { $subscribe: vi.fn(() => unsub) };

			wireLifecycleHooks(
				store,
				{},
				asConfig({ onUsed, onUnused }),
				[child],
				[],
			);

			invoke(store.onUsedHook);
			expect(onUsed).toHaveBeenCalledOnce();
			expect(child.$subscribe).toHaveBeenCalledOnce();

			invoke(store.onUnusedHook);
			expect(unsub).toHaveBeenCalledOnce();
			expect(onUnused).toHaveBeenCalledOnce();
		});
	});
});
