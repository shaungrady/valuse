/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { batchSets } from './signal.js';
import { createDeferral, type Deferral } from './utils/deferral.js';
import { InstanceStore } from './instance-store.js';
import {
	initialAsyncState,
	settingAsyncState,
	resolvedAsyncState,
	errorAsyncState,
} from './async-state.js';
import { ScopeMap } from './scope-map.js';
import { setNestedValue } from './scope-snapshot.js';
import type { ScopeDefinitionMeta, GroupMeta } from './slot-meta.js';

/** Per-run state for an async derivation's eager subscription model. @internal */
interface AsyncRun {
	controller: AbortController;
	/**
	 * Per-run de-duplication of eager subscriptions. Numeric keys identify
	 * slot subscriptions; string keys (`ref:<path>`) identify ref-source
	 * subscriptions, since refs don't have slot indices.
	 */
	subscriptions: Map<number | string, () => void>;
	cleanups: (() => void)[];
	/** Flushable deferral powering `ctx.deferBy`, governed by this run's signal. */
	deferral: Deferral;
	/** Resolves when this run settles (after its result/error is written). */
	completion: Promise<void>;
	/** Observable-output counter; bumped on each `ctx.set` emit. */
	emitCount: number;
	/** `true` once the run has settled (result/error written). */
	settled: boolean;
	/** Resolves on the next emit, deferral arm, or completion. */
	nextWake: () => Promise<void>;
}

/** Mutable ref to the current async run. Shared by the scope tree so it doesn't need rebuilding on every re-run. @internal */
interface AsyncRunRef {
	current: AsyncRun;
	scheduleRerun: () => void;
}

/**
 * Safety bound for the async-derivation flush chase. `flush()` expedites a
 * run to its next output; this caps the chase so a derivation that defers
 * in a loop without ever emitting can't hang flush() (and `$flush()`).
 * Deferrals are expedited (not timed), so legitimate runs settle in a
 * handful of passes — this only bites a genuinely non-terminating,
 * non-emitting loop.
 */
const FLUSH_CHASE_CAP = 1_000;

/** Abort an async run and release its eager subscriptions + registered cleanups. @internal */
function teardownAsyncRun(run: AsyncRun): void {
	run.controller.abort();
	for (const cleanup of run.cleanups) cleanup();
	for (const [, unsub] of run.subscriptions) unsub();
}

/** Set up async derivations using eager subscriptions. Each use() call subscribes to the signal; when any tracked dep changes, the derivation aborts and re-runs. @internal */
export function setupAsyncDerivations(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	initialValues: Map<number, unknown>,
	resolvedRefs: Map<string, unknown>,
	cleanups: (() => void)[],
): void {
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const meta = definition.slots[slot]!;

		if (meta.kind === 'asyncDerived' && meta.derivationFn) {
			const derivationFn = meta.derivationFn;
			const hasSeed = initialValues.has(slot);

			let lastValue: unknown = hasSeed ? initialValues.get(slot) : undefined;
			let isFirstRun = true;

			// Mutable ref so the scope tree (built once) always sees the current run
			const runRef: AsyncRunRef = {
				current: null!,
				scheduleRerun: null!,
			};

			const runDerivation = () => {
				// Abort previous run
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (runRef.current) {
					teardownAsyncRun(runRef.current);
				}

				const controller = new AbortController();
				const deferral = createDeferral(controller.signal);
				let resolveCompletion!: () => void;
				const completion = new Promise<void>((resolve) => {
					resolveCompletion = resolve;
				});
				// Flush instrumentation. `wake()` fires on each emit, deferral
				// arm, and completion; the flush chase (in `_flushFns`) waits on
				// it to advance the run to its next output.
				let wakeWaiters: (() => void)[] = [];
				const wake = (): void => {
					const waiters = wakeWaiters;
					wakeWaiters = [];
					for (const resolve of waiters) resolve();
				};
				runRef.current = {
					controller,
					subscriptions: new Map(),
					cleanups: [],
					deferral,
					completion,
					emitCount: 0,
					settled: false,
					nextWake: () =>
						new Promise<void>((resolve) => {
							wakeWaiters.push(resolve);
						}),
				};

				// Mark as running for cycle detection
				store.runningAsync.add(slot);

				// Transition to 'setting' state (skip on first run with seed)
				const asyncSignal = store.asyncStates.get(slot);
				if (asyncSignal && !(isFirstRun && hasSeed)) {
					const prev = asyncSignal.peek();
					asyncSignal.value = settingAsyncState(prev);
				}
				isFirstRun = false;

				const run = runRef.current;

				// Commit a resolved value: batch the data + asyncState writes so
				// React sees one atomic update; otherwise downstream computeds
				// (e.g. sync derivations reading this async slot) can be one step
				// stale when consumers re-render off the async state alone. Route
				// through the change-emitting path so `onChange` observers see
				// async writes; `beforeChange` is skipped — this is a computed
				// value, not a user mutation.
				const commitResolved = (value: unknown): void => {
					batchSets(() => {
						store._writeToSignal(slot, value, {
							skipBeforeChange: true,
						});
						if (asyncSignal) {
							asyncSignal.value = resolvedAsyncState(value);
						}
					});
				};

				const context = {
					scope: asyncScope,
					signal: controller.signal,
					set: (value: unknown) => {
						if (controller.signal.aborted) return;
						lastValue = value;
						commitResolved(value);
						// An emit is an observable output: count it and wake any
						// in-flight flush so it can stop chasing.
						run.emitCount += 1;
						wake();
					},
					onCleanup: (fn: () => void) => {
						run.cleanups.push(fn);
					},
					deferBy: (ms: number) => {
						const promise = deferral.deferBy(ms);
						// Wake any in-flight flush so it can expedite this fresh
						// deferral instead of waiting out its real timer.
						wake();
						return promise;
					},
					previousValue: lastValue,
				};

				// Run the async function
				try {
					const promise = derivationFn(context) as Promise<unknown>;
					// The synchronous phase (up to the first `await`) is done —
					// drop the cycle-detection marker now. Genuine cycles
					// (synchronous self-`use()`) are caught during that phase;
					// keeping the marker through the async phase would falsely
					// flag a *downstream* async derivation that legitimately
					// reads this still-pending one (e.g. preview → results).
					store.runningAsync.delete(slot);
					promise
						.then((result: unknown) => {
							store.runningAsync.delete(slot);
							if (controller.signal.aborted) return;
							if (result !== undefined) {
								if (result === lastValue) {
									if (asyncSignal && asyncSignal.peek().status !== 'set') {
										asyncSignal.value = resolvedAsyncState(lastValue);
									}
									return;
								}
								lastValue = result;
								commitResolved(result);
							} else if (asyncSignal && !asyncSignal.peek().hasValue) {
								asyncSignal.value = initialAsyncState();
							} else if (asyncSignal) {
								asyncSignal.value = resolvedAsyncState(lastValue);
							}
						})
						.catch((error: unknown) => {
							store.runningAsync.delete(slot);
							if (controller.signal.aborted) return;
							if (asyncSignal) {
								asyncSignal.value = errorAsyncState(asyncSignal.peek(), error);
							}
						})
						.finally(() => {
							run.settled = true;
							wake();
							resolveCompletion();
						});
				} catch (error) {
					store.runningAsync.delete(slot);
					if (asyncSignal) {
						asyncSignal.value = errorAsyncState(asyncSignal.peek(), error);
					}
					run.settled = true;
					wake();
					resolveCompletion();
				}
			};

			// Build scope tree once, reused across all runs via runRef
			runRef.scheduleRerun = runDerivation;
			const asyncScope = buildAsyncDerivationScope(
				definition,
				store,
				slot,
				runRef,
				resolvedRefs,
			);

			// Register recompute function
			store._recomputeFns.set(slot, runDerivation);

			// Register flush: expedite the active deferral and chase the run —
			// re-expediting each freshly-armed deferral — until it emits (set),
			// completes, or hits FLUSH_CHASE_CAP. The cap guards a derivation
			// that defers in a loop without ever emitting; without it, flush()
			// (and $flush()) would hang. Registering `nextWake()` before
			// `deferral.flush()` is load-bearing: flush schedules the run's
			// continuation as a microtask, so the waiter must already be in
			// place to catch the emit / arm / completion it produces.
			store._flushFns.set(slot, async () => {
				const run = runRef.current;
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (!run) return;
				const emitMark = run.emitCount;
				for (let pass = 0; pass < FLUSH_CHASE_CAP; pass += 1) {
					if (run.settled || run.emitCount > emitMark) return;
					const woke = run.nextWake();
					run.deferral.flush();
					await Promise.race([woke, run.completion]);
				}
				console.warn(
					`valuse: .flush() on derivation "${meta.path}" gave up after ` +
						`${String(FLUSH_CHASE_CAP)} iterations — it appears to defer in a ` +
						'loop without ever emitting a value (via set/return) or completing, ' +
						'so flush() cannot settle it.',
				);
			});

			// Register a cleanup that aborts the in-flight run and tears down
			// eager subscriptions. Runs on $destroy per the docs contract.
			cleanups.push(() => {
				const run = runRef.current;
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (!run) return;
				teardownAsyncRun(run);
				run.cleanups.length = 0;
				run.subscriptions.clear();
				store.runningAsync.delete(slot);
			});

			// Run initial derivation
			runDerivation();
		}
	}
}

/** Build a derivation scope for async context that eagerly subscribes on each use() call. Built once per derivation; uses a mutable runRef so it doesn't need rebuilding on re-runs. @internal */
function buildAsyncDerivationScope(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	derivationSlot: number,
	runRef: AsyncRunRef,
	resolvedRefs: Map<string, unknown>,
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	const tree = buildAsyncGroupNode(
		definition,
		store,
		derivationSlot,
		runRef,
		rootGroup,
	);
	// Mirror the sync path (which attaches refs after the slot/group walk):
	// async derivations must also see `scope.<ref>.use()` / `.get()`, and
	// `.use()` must register an eager subscription on the ref's source so
	// dep changes trigger a re-run.
	for (const [path, resolved] of resolvedRefs) {
		const wrapped = wrapRefForAsyncDerivation(resolved, runRef, path);
		setNestedValue(tree, path, wrapped ?? resolved);
	}
	return tree;
}

/**
 * Async counterpart to `wrapRefForDerivation`. The sync wrapper relies
 * on Preact's automatic dep tracking inside `computed()`; async derivations
 * use an eager-subscription model instead, so each ref shape registers a
 * subscription on its source via the source's own `subscribe`/`$subscribe`.
 * Per-run dedup is keyed by `ref:<path>` so the same ref `.use()`'d multiple
 * times in one run only subscribes once.
 * @internal
 */
function wrapRefForAsyncDerivation(
	resolved: unknown,
	runRef: AsyncRunRef,
	path: string,
): { use: () => unknown; get: () => unknown } | undefined {
	if (typeof resolved !== 'object' || resolved === null) return undefined;

	const subKey = `ref:${path}`;

	const buildWrapper = (
		subscribe: (cb: () => void) => () => void,
		getValue: () => unknown,
	) => ({
		use: () => {
			const run = runRef.current;
			if (!run.subscriptions.has(subKey)) {
				const unsub = subscribe(() => {
					if (!run.controller.signal.aborted) {
						runRef.scheduleRerun();
					}
				});
				run.subscriptions.set(subKey, unsub);
			}
			return getValue();
		},
		get: getValue,
	});

	// Scope instance: `.use()` returns the instance, tracked via $subscribe
	// (whole-scope: fires on any field change), matching the coarse-grained
	// sync behavior backed by `_trackAll`.
	if ('$subscribe' in resolved && typeof resolved.$subscribe === 'function') {
		const instance = resolved as {
			$subscribe: (cb: () => void) => () => void;
		};
		return buildWrapper(
			(cb) => instance.$subscribe(cb),
			() => instance,
		);
	}

	// ScopeMap: subscribe fires on key-list changes only, matching `_trackKeys`.
	if (resolved instanceof ScopeMap) {
		const map = resolved;
		return buildWrapper(
			(cb) =>
				map.subscribe(() => {
					cb();
				}),
			() => map,
		);
	}

	// Value / ValueSet / ValueMap / ValueArray — anything with .subscribe + .get.
	if (
		'subscribe' in resolved &&
		typeof resolved.subscribe === 'function' &&
		'get' in resolved &&
		typeof (resolved as { get: unknown }).get === 'function'
	) {
		const source = resolved as {
			subscribe: (cb: () => void) => () => void;
			get: () => unknown;
		};
		return buildWrapper(
			(cb) =>
				source.subscribe(() => {
					cb();
				}),
			() => source.get(),
		);
	}

	return undefined;
}

function buildAsyncGroupNode(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	derivationSlot: number,
	runRef: AsyncRunRef,
	group: GroupMeta,
): Record<string, unknown> {
	const node: Record<string, unknown> = {};

	for (const slotIndex of group.childSlots) {
		const meta = definition.slots[slotIndex]!;
		const fieldName = meta.fieldName;

		node[fieldName] = {
			use: () => {
				// Cycle detection
				if (store.runningAsync.has(slotIndex)) {
					throw new Error(
						`Cycle detected: async derivation at "${meta.path}" tried to use() itself or a currently-running async derivation`,
					);
				}

				const run = runRef.current;
				// Eager subscribe if not already subscribed for this run
				if (!run.subscriptions.has(slotIndex)) {
					const unsub = store.subscribe(slotIndex, () => {
						if (!run.controller.signal.aborted) {
							runRef.scheduleRerun();
						}
					});
					run.subscriptions.set(slotIndex, unsub);
				}

				return store.read(slotIndex);
			},
			get: () => store.read(slotIndex),
			getAsync: () => store.readAsync(slotIndex),
		};
	}

	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		node[fieldName] = buildAsyncGroupNode(
			definition,
			store,
			derivationSlot,
			runRef,
			childGroup,
		);
	}

	return node;
}
