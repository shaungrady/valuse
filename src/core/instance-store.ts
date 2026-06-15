/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { signal, type Signal } from './signal.js';
import {
	subscribeFireOnly,
	subscribeWithPrevious,
} from './utils/effect-helpers.js';
import type { AsyncState } from './async-state.js';
import { initialAsyncState, resolvedAsyncState } from './async-state.js';
import { runValidation, type ValidationState } from './value-schema.js';
import type { Change, ScopeNode, Unsubscribe } from './types.js';
import type { ScopeDefinitionMeta, DefinitionPipeStep } from './slot-meta.js';
import { buildPipeChain, type PipeChain } from './utils/pipe-runtime.js';

/**
 * Per-instance data store. Holds signals and manages the write pipeline,
 * change tracking, and subscriptions. All field wrappers delegate to this.
 *
 * Static metadata (paths, pipelines, comparators) lives on the shared
 * {@link ScopeDefinitionMeta}, not duplicated here.
 *
 * @internal
 */
export class InstanceStore {
	/**
	 * One signal per reactive slot. Plain slots also occupy a position here
	 * (so iteration over `signals[]` stays length-aligned with `slotCount`),
	 * but their signal is never written to after construction — plain reads
	 * and writes are routed through {@link #plainValues} so plain fields
	 * stay invisible to the reactive graph (`$subscribe`, derivations,
	 * `_trackAll`). The snapshot cache is invalidated via {@link _plainVersion}.
	 */
	readonly signals: Signal<unknown>[];

	/**
	 * Backing storage for plain (`valuePlain`) slot values. Updated directly
	 * by {@link _writeToSignal} so plain writes do not fire any Preact
	 * effect — they're "inert" by docs contract. Read by {@link read} /
	 * {@link readTracked} when the slot is plain.
	 *
	 * Allocated lazily (`null` until the first plain slot is seeded in the
	 * constructor) so scopes with no plain fields don't pay for an empty Map.
	 * @internal
	 */
	#plainValues: Map<number, unknown> | null = null;

	/**
	 * Coarse "any plain field changed" signal. Tracked by the snapshot
	 * invalidator in `attachDollarMethods` so `$getSnapshot()` returns
	 * fresh data after a plain write, while leaving every other reactive
	 * consumer (`$subscribe`, derivations) untouched.
	 * @internal
	 */
	readonly _plainVersion: Signal<number> = signal(0);

	/**
	 * Async state signals, keyed by slot index. Allocated lazily — `null`
	 * unless the scope has at least one async derivation.
	 */
	asyncStates: Map<number, Signal<AsyncState<unknown>>> | null = null;

	/**
	 * Validation state signals, keyed by slot index. Allocated lazily — `null`
	 * unless the scope has at least one schema slot.
	 */
	validationStates: Map<
		number,
		Signal<ValidationState<unknown, unknown>>
	> | null = null;

	/**
	 * Active factory-pipe chains, keyed by slot index. Allocated lazily — `null`
	 * unless the scope has at least one factory-piped slot.
	 */
	#pipeChains: Map<number, PipeChain> | null = null;

	/** The shared definition metadata. */
	readonly definition: ScopeDefinitionMeta;

	/** Whether this instance has been destroyed. */
	destroyed = false;

	/**
	 * Slot indices of currently-executing async derivations. Used for cycle
	 * detection. `null` unless the scope has at least one async derivation.
	 */
	readonly runningAsync: Set<number> | null;

	/**
	 * The instance tree (set after construction). Needed for changesByScope
	 * keys and the scope argument in hooks.
	 */
	#scopeNodesBySlot: Map<number, ScopeNode> = new Map();
	#scopeNodesByGroup: Map<number, ScopeNode> = new Map();
	/**
	 * Reverse map (node → slot) for change-context bubbling. Built lazily on
	 * the first {@link #buildChangeContext} call — which only happens once an
	 * `onChange`/`beforeChange` hook fires — so hook-less scopes never pay for
	 * it.
	 */
	#slotByNode: Map<ScopeNode, number> | null = null;
	#instanceRoot: ScopeNode | null = null;

	// --- Change batching ---

	#pendingChanges: Change[] | null = null;
	#changeBatchScheduled = false;
	// Set while an onChange callback is executing. Sync writes from inside
	// the callback skip the change-tracking + scheduling path entirely, so
	// "auto-fill from change" patterns (e.g. lastUpdated.set(Date.now()))
	// do not loop back into a fresh onChange invocation. Subscribers and
	// derivations still propagate normally — only the onChange machinery
	// ignores the self-write.
	#inOnChangeCallback = false;

	// --- Hooks (set by scope creation) ---

	/** @internal */ onChangeHook:
		| ((context: {
				scope: ScopeNode;
				changes: Set<Change>;
				changesByScope: Map<ScopeNode, Change[]>;
		  }) => void)
		| null = null;

	// --- Subscriber tracking (onUsed / onUnused) ---

	#subscriberCount = 0;

	/** @internal */ onUsedHook: (() => void) | null = null;
	/** @internal */ onUnusedHook: (() => void) | null = null;

	/** @internal */ beforeChangeHook:
		| ((context: {
				scope: ScopeNode;
				changes: Set<Change>;
				changesByScope: Map<ScopeNode, Change[]>;
				prevent: (target?: ScopeNode | Change) => void;
		  }) => void)
		| null = null;

	constructor(
		definition: ScopeDefinitionMeta,
		initialValues: Map<number, unknown>,
	) {
		this.definition = definition;
		// Only async derivations ever add to `runningAsync`; allocate it only
		// when the scope has any, so value-only scopes don't carry an empty Set.
		this.runningAsync =
			definition.asyncDerivedSlots.length > 0 ? new Set() : null;

		// Allocate signals
		this.signals = Array.from<Signal<unknown>>({
			length: definition.slotCount,
		});
		for (let slot = 0; slot < definition.slotCount; slot++) {
			const meta = definition.slots[slot]!;
			const hasUserInitial = initialValues.has(slot);
			const initial =
				hasUserInitial ? initialValues.get(slot) : meta.defaultValue;

			if (meta.kind === 'asyncDerived') {
				this.asyncStates ??= new Map();
				this.asyncStates.set(
					slot,
					signal(
						hasUserInitial ? resolvedAsyncState(initial) : initialAsyncState(),
					),
				);
			}

			// Whether the sync pipeline still needs to run against `initial`.
			// User-supplied initials (from `.create({...})`) are raw, so
			// they always go through the pipeline. The slot's `defaultValue`
			// only needs piping when it came from a `ValuePlain` (whose
			// `_value` is stored raw and depends on the pipeline to produce
			// the typed output). For `value()` / `valueSchema()`, the
			// `defaultValue` is captured from the chained Value's
			// post-pipe signal, so re-applying the pipeline here would
			// double-apply every sync step — e.g. `value(5).pipe(x => x*2)`
			// would store 20 instead of 10.
			const shouldApplyPipeline = hasUserInitial || meta.kind === 'plain';
			const processed =
				shouldApplyPipeline && meta.pipeline ?
					this.#applySyncPipeline(initial, meta.pipeline)
				:	initial;

			this.signals[slot] = signal(processed);

			// Plain slots also seed `#plainValues` — that's what
			// `read`/`readTracked` actually return for plain. Seeding here (for
			// every plain slot) is what makes the lazy map safe to read before
			// any write: a plain slot always has an entry by end of construction.
			if (meta.kind === 'plain') {
				this.#plainValues ??= new Map();
				this.#plainValues.set(slot, processed);
			}

			// Initialize validation state for schema slots
			if (meta.kind === 'schema' && meta.schema) {
				this.validationStates ??= new Map();
				this.validationStates.set(
					slot,
					signal(runValidation(meta.schema, processed)),
				);
			}
		}

		// Activate factory pipes for every slot whose pipeline contains a
		// factory step. Without this, factory pipes inside scope definitions
		// (pipeDebounce / pipeThrottle / pipeBatch / ...) are silently dead:
		// `write()` only routes through `#pipeChains.get(slot)` when populated,
		// and `#applySyncPipeline` stops at the first factory — so a
		// `value('').pipe(pipeDebounce(300))` field would fire immediately
		// instead of debouncing. Standalone `Value.pipe(factory)` already
		// self-activates in `value.ts`; this brings scope slots to parity.
		//
		// After activation, prime the chain so stateful actors (scan,
		// unique, throttle, …) observe the seed, matching standalone
		// `Value.pipe(factory)` priming. Seed is the pre-actor value:
		// the user's initial run through leading sync steps, or the
		// template's captured `factorySeed`. The prime overwrites the
		// signal with the post-actor commit, which for same-type actors
		// equals the seeded `defaultValue` (no-op) and for accumulating
		// actors leaves the actor state matching standalone.
		for (let slot = 0; slot < definition.slotCount; slot++) {
			const meta = definition.slots[slot]!;
			if (!meta.pipeline?.some((step) => step.kind === 'factory')) {
				continue;
			}
			this.activateFactoryPipes(slot);
			const chain = this.#pipeChains?.get(slot);
			if (!chain) continue;
			const hasUserInitial = initialValues.has(slot);
			const seed =
				hasUserInitial ?
					this.#applySyncPipeline(initialValues.get(slot), meta.pipeline)
				:	meta.factorySeed;
			chain.prime(seed);
		}
	}

	/**
	 * Register the instance tree so the store can reference scope nodes
	 * in change tracking.
	 */
	registerTree(
		instanceRoot: ScopeNode,
		nodesBySlot: Map<number, ScopeNode>,
		nodesByGroup: Map<number, ScopeNode>,
	): void {
		this.#instanceRoot = instanceRoot;
		this.#scopeNodesBySlot = nodesBySlot;
		this.#scopeNodesByGroup = nodesByGroup;
		// `#slotByNode` (the node → slot reverse map) is built lazily on the
		// first change-context, so scopes without change hooks never build it.
	}

	/**
	 * Read a slot's current value without tracking. Plain slots bypass the
	 * signal entirely and read from {@link #plainValues}.
	 */
	read(slot: number): unknown {
		if (this.definition.slots[slot]!.kind === 'plain') {
			return this.#plainValues?.get(slot);
		}
		return this.signals[slot]!.peek();
	}

	/**
	 * Whether a slot is declared readonly. Only meaningful for `plain` slots.
	 */
	isReadonly(slot: number): boolean {
		return this.definition.slots[slot]!.readonly;
	}

	/**
	 * Read a slot's current value with Preact tracking (for use inside
	 * computed/effect). Plain reads are deliberately untracked, since plain
	 * fields are documented as inert — derivations that `.use()` a plain slot
	 * must not re-run when the plain value changes.
	 */
	readTracked(slot: number): unknown {
		if (this.definition.slots[slot]!.kind === 'plain') {
			return this.#plainValues?.get(slot);
		}
		return this.signals[slot]!.value;
	}

	/**
	 * Write a value to a slot, running through the pipeline and change hooks.
	 */
	write(slot: number, value: unknown): void {
		if (this.destroyed) return;

		const meta = this.definition.slots[slot]!;

		// Factory-pipe chain (actors own their scheduling and apply leading
		// sync steps internally).
		const chain = this.#pipeChains?.get(slot);
		if (chain && chain.hasActors) {
			chain.write(value);
			return;
		}

		// All-sync pipeline
		const next =
			meta.pipeline ? this.#applySyncPipeline(value, meta.pipeline) : value;

		this._writeToSignal(slot, next);
	}

	/**
	 * Write directly to a signal, running comparator and change hooks.
	 * Used by the sync pipeline path and by factory pipe set() callbacks.
	 *
	 * Bug fix: `write()` already short-circuits when the store is destroyed,
	 * but this method is *also* invoked directly by factory pipe `set`
	 * callbacks — and some of those (notably `pipeBatch`) defer writes via
	 * `Promise.resolve().then(...)` with no `onCleanup`. Without a guard
	 * here, a `$destroy()` between the `.set(...)` and the deferred flush
	 * would still mutate the disposed slot's signal and surface that
	 * change to any consumer subscribed via a path other than the
	 * instance's own disposers (e.g. an external `valueRef`).
	 *
	 * @param options.skipBeforeChange - skip the `beforeChange` hook. Used by
	 *   async-derivation result writes, which aren't user mutations and so
	 *   shouldn't be veto-able. `onChange` still fires so consumers can
	 *   react to computed results (e.g. hydrate collections from a fetched
	 *   payload).
	 */
	_writeToSignal(
		slot: number,
		value: unknown,
		options?: { skipBeforeChange?: boolean },
	): void {
		if (this.destroyed) return;
		const meta = this.definition.slots[slot]!;
		const previous = this.signals[slot]!.peek();

		// Plain slots: write to the non-reactive backing map and bump the
		// coarse plain-version signal. The signal in `signals[slot]` is
		// intentionally NOT updated, so plain writes are invisible to
		// `$subscribe`, derivations, and `_trackAll`. Only the snapshot
		// invalidator tracks `_plainVersion`, which keeps `$getSnapshot()`
		// fresh without re-rendering the rest of the reactive graph.
		if (meta.kind === 'plain') {
			this.#plainValues ??= new Map();
			this.#plainValues.set(slot, value);
			this._plainVersion.value++;
			return;
		}

		// Comparator check
		if (meta.comparator && meta.comparator(previous, value)) {
			return;
		}

		// Build change record
		const scopeNode = this.#scopeNodesBySlot.get(slot);
		const change: Change = {
			scope: scopeNode ?? {},
			path: meta.path,
			from: previous,
			to: value,
		};

		// beforeChange — synchronous, can prevent
		if (
			!options?.skipBeforeChange &&
			this.beforeChangeHook &&
			this.#instanceRoot
		) {
			const { changes, changesByScope } = this.#buildChangeContext([change]);
			// `prevented` is mutated inside the `prevent` callback, but TS
			// narrows it to `false` for the post-call check. Use a ref to keep
			// the boolean view honest.
			const preventedRef = { value: false };
			this.beforeChangeHook({
				scope: this.#instanceRoot,
				changes,
				changesByScope,
				prevent: (target) => {
					// No target = prevent all
					if (target === undefined) {
						preventedRef.value = true;
						return;
					}
					if (target === change || target === scopeNode) {
						preventedRef.value = true;
					}
					// Check if target is an ancestor group
					for (const ancestorIdx of meta.ancestorGroupIndices) {
						if (target === this.#scopeNodesByGroup.get(ancestorIdx)) {
							preventedRef.value = true;
						}
					}
				},
			});
			if (preventedRef.value) return;
		}

		// Write to signal
		this.signals[slot]!.value = value;

		// Update validation state for schema slots
		if (meta.kind === 'schema' && meta.schema) {
			const validationSignal = this.validationStates?.get(slot);
			if (validationSignal) {
				validationSignal.value = runValidation(meta.schema, value);
			}
		}

		// Queue onChange — but skip if this write came from inside an
		// onChange callback. Self-writes during the callback are
		// considered part of the same change event and don't get a fresh
		// tick of their own.
		if (this.onChangeHook && !this.#inOnChangeCallback) {
			if (!this.#pendingChanges) {
				this.#pendingChanges = [];
			}
			this.#pendingChanges.push(change);
			this.#scheduleOnChange();
		}
	}

	/**
	 * Subscribe to a specific slot's changes.
	 */
	subscribe(
		slot: number,
		fn: (value: unknown, previous: unknown) => void,
	): Unsubscribe {
		this.#incrementSubscribers();
		const dispose = subscribeWithPrevious(
			() => this.signals[slot]!.value,
			() => this.signals[slot]!.peek(),
			fn,
		);

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			dispose();
			this.#decrementSubscribers();
		};
	}

	/**
	 * Increment the subscriber count. Fires onUsed on the 0 → 1 transition.
	 * @internal
	 */
	#incrementSubscribers(): void {
		this.#subscriberCount++;
		if (this.#subscriberCount === 1 && this.onUsedHook) {
			this.onUsedHook();
		}
	}

	/**
	 * Decrement the subscriber count. Fires onUnused on the 1 → 0 transition.
	 * @internal
	 */
	#decrementSubscribers(): void {
		this.#subscriberCount--;
		if (this.#subscriberCount === 0 && this.onUnusedHook) {
			this.onUnusedHook();
		}
	}

	/**
	 * Register an external subscription (e.g. $subscribe) with the
	 * subscriber count tracking, without routing through a slot.
	 * Returns an unsubscribe function that decrements the count.
	 * @internal
	 */
	trackExternalSubscription(): Unsubscribe {
		this.#incrementSubscribers();
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			this.#decrementSubscribers();
		};
	}

	/**
	 * Re-run a derivation. The actual recompute logic is set up during
	 * scope instance creation (Phase 5). This is a hook point.
	 * @internal
	 */
	recompute(slot: number): void {
		const recomputeFn = this.#recomputeFns?.get(slot);
		if (recomputeFn) recomputeFn();
	}

	/**
	 * Recompute functions, registered by scope creation for derived/async
	 * slots. Allocated lazily on first registration so value-only scopes
	 * carry no Map.
	 */
	#recomputeFns: Map<number, () => void> | null = null;

	/**
	 * Async-derivation flush functions, registered at creation. Allocated
	 * lazily on first registration so non-async scopes carry no Map.
	 */
	#flushFns: Map<number, () => Promise<void>> | null = null;

	/**
	 * Register a recompute function for a slot. @internal — called by scope
	 * creation for each derived/async slot.
	 */
	registerRecompute(slot: number, fn: () => void): void {
		this.#recomputeFns ??= new Map();
		this.#recomputeFns.set(slot, fn);
	}

	/**
	 * Register an async-derivation flush function for a slot. @internal —
	 * called by scope creation for each async slot.
	 */
	registerFlush(slot: number, fn: () => Promise<void>): void {
		this.#flushFns ??= new Map();
		this.#flushFns.set(slot, fn);
	}

	/**
	 * Expedite and await any pending deferred work for a slot: a value
	 * field's pipe chain, or an async derivation's in-flight `deferBy`.
	 * Resolves immediately when there is nothing to flush.
	 */
	flushSlot(slot: number): Promise<void> {
		const chain = this.#pipeChains?.get(slot);
		if (chain) return chain.flush();
		const flushFn = this.#flushFns?.get(slot);
		if (flushFn) return flushFn();
		return Promise.resolve();
	}

	/**
	 * Read validation state for a schema slot.
	 */
	readValidation(slot: number): ValidationState<unknown, unknown> {
		return (
			this.validationStates?.get(slot)?.peek() ?? {
				isValid: true,
				value: this.read(slot),
				issues: [],
			}
		);
	}

	/**
	 * Subscribe to validation state changes for a schema slot.
	 */
	subscribeValidation(slot: number, fn: () => void): Unsubscribe {
		const validationSignal = this.validationStates?.get(slot);
		if (!validationSignal) return () => {};
		return subscribeFireOnly(() => {
			void validationSignal.value;
		}, fn);
	}

	/**
	 * Read async state for a slot.
	 */
	readAsync(slot: number): AsyncState<unknown> {
		return this.asyncStates?.get(slot)?.peek() ?? initialAsyncState();
	}

	/**
	 * Subscribe to async state changes for a slot.
	 * Fires when the async state transitions (setting, set, error).
	 */
	subscribeAsyncState(slot: number, fn: () => void): Unsubscribe {
		const asyncSignal = this.asyncStates?.get(slot);
		if (!asyncSignal) return () => {};
		return subscribeFireOnly(() => {
			void asyncSignal.value;
		}, fn);
	}

	/**
	 * Activate factory pipes for a slot.
	 */
	activateFactoryPipes(slot: number): void {
		const meta = this.definition.slots[slot]!;
		if (!meta.pipeline) return;
		if (!meta.pipeline.some((step) => step.kind === 'factory')) return;

		const chain = buildPipeChain(meta.pipeline, (value) => {
			this._writeToSignal(slot, value);
		});
		this.#pipeChains ??= new Map();
		this.#pipeChains.set(slot, chain);
	}

	/**
	 * Destroy this instance. Abort async work, run factory cleanups.
	 */
	destroy(): void {
		this.destroyed = true;

		// Clean up factory-pipe chains (aborts host signals, runs cleanups)
		if (this.#pipeChains) {
			for (const [, chain] of this.#pipeChains) chain.destroy();
			this.#pipeChains = null;
		}
	}

	// --- Private helpers ---

	#applySyncPipeline(
		value: unknown,
		pipeline: readonly DefinitionPipeStep[],
	): unknown {
		let current = value;
		for (const step of pipeline) {
			if (step.kind === 'sync') {
				current = step.transform(current);
			}
			// Stop at first factory — factory pipes are handled separately
			if (step.kind === 'factory') break;
		}
		return current;
	}

	#buildChangeContext(changes: Change[]): {
		changes: Set<Change>;
		changesByScope: Map<ScopeNode, Change[]>;
	} {
		const changeSet = new Set(changes);
		const changesByScope = new Map<ScopeNode, Change[]>();

		// Build the node → slot reverse map on first use. Reaching here means a
		// change hook fired, so the cost lands only on hook-bearing scopes, and
		// only after `registerTree` has populated `#scopeNodesBySlot`.
		let slotByNode = this.#slotByNode;
		if (!slotByNode) {
			slotByNode = new Map();
			for (const [slot, node] of this.#scopeNodesBySlot) {
				slotByNode.set(node, slot);
			}
			this.#slotByNode = slotByNode;
		}

		for (const change of changes) {
			// Add to the field's own scope node
			const existing = changesByScope.get(change.scope);
			if (existing) {
				existing.push(change);
			} else {
				changesByScope.set(change.scope, [change]);
			}

			// Bubble up to ancestor groups via O(1) reverse lookup
			const slotIndex = slotByNode.get(change.scope);
			if (slotIndex !== undefined) {
				const meta = this.definition.slots[slotIndex]!;
				for (const ancestorIdx of meta.ancestorGroupIndices) {
					const groupNode = this.#scopeNodesByGroup.get(ancestorIdx);
					if (groupNode) {
						const groupChanges = changesByScope.get(groupNode);
						if (groupChanges) {
							groupChanges.push(change);
						} else {
							changesByScope.set(groupNode, [change]);
						}
					}
				}
			}

			// Also add to root
			if (this.#instanceRoot) {
				const rootChanges = changesByScope.get(this.#instanceRoot);
				if (rootChanges) {
					rootChanges.push(change);
				} else {
					changesByScope.set(this.#instanceRoot, [change]);
				}
			}
		}

		return { changes: changeSet, changesByScope };
	}

	#scheduleOnChange(): void {
		if (this.#changeBatchScheduled) return;
		this.#changeBatchScheduled = true;

		void Promise.resolve().then(() => {
			this.#changeBatchScheduled = false;
			const pending = this.#pendingChanges;
			this.#pendingChanges = null;
			if (this.destroyed) return;
			if (!pending || pending.length === 0 || !this.onChangeHook) return;

			const { changes, changesByScope } = this.#buildChangeContext(pending);
			this.#inOnChangeCallback = true;
			try {
				this.onChangeHook({
					scope: this.#instanceRoot!,
					changes,
					changesByScope,
				});
			} finally {
				this.#inOnChangeCallback = false;
			}
		});
	}
}
