import type { InstanceStore } from './instance-store.js';
import type { ScopeConfig } from './scope-config.js';
import type { GenericScopeInstance } from './scope-types.js';

/**
 * Fire the `onCreate` lifecycle hook with a fresh `AbortController` whose
 * signal aborts when the scope is destroyed (or, in the `$setSnapshot
 * recreate` path, when the next recreate cycle starts). The controller is
 * created unconditionally so the lifecycle-cleanups list always grows by
 * exactly one entry — keeps the create / recreate paths symmetric.
 * @internal
 */
export function fireOnCreate(
	config: ScopeConfig | undefined,
	instance: Record<string, unknown>,
	input: Record<string, unknown> | undefined,
	lifecycleCleanups: (() => void)[],
): void {
	const controller = new AbortController();
	lifecycleCleanups.push(() => {
		controller.abort();
	});
	if (config?.onCreate) {
		config.onCreate({
			scope: instance as GenericScopeInstance,
			input,
			signal: controller.signal,
			onCleanup: (fn) => lifecycleCleanups.push(fn),
		});
	}
}

/**
 * Wire the change/usage lifecycle hooks (`onChange`, `beforeChange`,
 * `onUsed`/`onUnused`) onto the store, plus transitive onUsed/onUnused
 * propagation to scope-instance refs. Split out of `createScopeInstance` so
 * the orchestrator reads as a high-level pipeline.
 * @internal
 */
export function wireLifecycleHooks(
	store: InstanceStore,
	instance: Record<string, unknown>,
	config: ScopeConfig | undefined,
	transitiveLifecycleRefs: Record<string, unknown>[],
	instanceCleanups: (() => void)[],
): void {
	// The runtime `context.scope` is the live ScopeInstance (branded as
	// ScopeNode at the InstanceStore boundary), so the cast to the user-facing
	// hook context type is sound at runtime.
	if (config?.onChange) {
		const onChange = config.onChange;
		store.onChangeHook = (context) => {
			onChange(context as Parameters<typeof onChange>[0]);
		};
	}

	if (config?.beforeChange) {
		const beforeChange = config.beforeChange;
		store.beforeChangeHook = (context) => {
			beforeChange(context as Parameters<typeof beforeChange>[0]);
		};
	}

	// Wire onUsed/onUnused subscriber tracking
	if (config?.onUsed || config?.onUnused) {
		let usedController: AbortController | null = null;
		let usedCleanups: (() => void)[] = [];

		if (config.onUsed) {
			const onUsedConfig = config.onUsed;
			store.onUsedHook = () => {
				usedController = new AbortController();
				usedCleanups = [];
				onUsedConfig({
					scope: instance as GenericScopeInstance,
					signal: usedController.signal,
					onCleanup: (fn) => usedCleanups.push(fn),
				});
			};
		}

		store.onUnusedHook = () => {
			// Run onUsed cleanups and abort signal
			for (const cleanup of usedCleanups) cleanup();
			usedCleanups = [];
			if (usedController) {
				usedController.abort();
				usedController = null;
			}
			// Fire onUnused callback
			if (config.onUnused) {
				config.onUnused({ scope: instance as GenericScopeInstance });
			}
		};

		// Clean up on destroy
		instanceCleanups.push(() => {
			for (const cleanup of usedCleanups) cleanup();
			usedCleanups = [];
			if (usedController) {
				usedController.abort();
				usedController = null;
			}
		});
	}

	// Propagate onUsed/onUnused transitively to every scope-instance ref —
	// shared or factory-created. Lifting an in-scope subscription on the
	// parent should "use" each referenced child, matching the README's
	// transitive-lifecycle contract.
	if (transitiveLifecycleRefs.length > 0) {
		const originalOnUsed = store.onUsedHook;
		const originalOnUnused = store.onUnusedHook;
		const childUntrackFns: (() => void)[] = [];

		store.onUsedHook = () => {
			originalOnUsed?.();
			for (const refInstance of transitiveLifecycleRefs) {
				const unsub = (
					refInstance.$subscribe as (fn: () => void) => () => void
				)(() => {});
				childUntrackFns.push(unsub);
			}
		};

		store.onUnusedHook = () => {
			// Unsubscribe from children first (triggers their onUnused)
			for (const unsub of childUntrackFns) unsub();
			childUntrackFns.length = 0;
			originalOnUnused?.();
		};

		// Release the transitive child subscriptions on parent $destroy too.
		// `store.destroy()` only flips a flag — it does not invoke
		// `onUnusedHook` — so a parent destroyed *while still subscribed*
		// would otherwise leave every referenced child believing it still
		// has a live subscriber. The children's own onUnused (and any
		// onUsed cleanup they registered) would never fire, leaking their
		// reactive subscriptions for the lifetime of the process.
		instanceCleanups.push(() => {
			for (const unsub of childUntrackFns) unsub();
			childUntrackFns.length = 0;
		});
	}
}
