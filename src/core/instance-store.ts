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

// --- Factory pipe runtime state ---

interface ActiveFactoryPipe {
	write: (value: unknown) => void;
	cleanups: (() => void)[];
}

/**
 * Maximum number of consecutive microtask ticks in which an `onChange`
 * callback may write back into its own scope before the loop is broken.
 * Crossed almost exclusively by accidental infinite loops; legitimate
 * "auto-fill from change" chains reach a fixed point in just a few ticks.
 */
const ONCHANGE_RESCHEDULE_LIMIT = 50;

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
	 * @internal
	 */
	readonly #plainValues = new Map<number, unknown>();

	/**
	 * Coarse "any plain field changed" signal. Tracked by the snapshot
	 * invalidator in `attachDollarMethods` so `$getSnapshot()` returns
	 * fresh data after a plain write, while leaving every other reactive
	 * consumer (`$subscribe`, derivations) untouched.
	 * @internal
	 */
	readonly _plainVersion: Signal<number> = signal(0);

	/** Async state signals, keyed by slot index. Only populated for async derivations. */
	readonly asyncStates: Map<number, Signal<AsyncState<unknown>>>;

	/** Validation state signals, keyed by slot index. Only populated for schema slots. */
	readonly validationStates: Map<
		number,
		Signal<ValidationState<unknown, unknown>>
	>;

	/** Active factory pipe instances, keyed by slot index. */
	readonly #factoryPipes: Map<number, ActiveFactoryPipe[]>;

	/** The shared definition metadata. */
	readonly definition: ScopeDefinitionMeta;

	/** Whether this instance has been destroyed. */
	destroyed = false;

	/**
	 * Slot indices of currently-executing async derivations.
	 * Used for cycle detection.
	 */
	readonly runningAsync: Set<number> = new Set();

	/**
	 * The instance tree (set after construction). Needed for changesByScope
	 * keys and the scope argument in hooks.
	 */
	#scopeNodesBySlot: Map<number, ScopeNode> = new Map();
	#scopeNodesByGroup: Map<number, ScopeNode> = new Map();
	#slotByNode: Map<ScopeNode, number> = new Map();
	#instanceRoot: ScopeNode | null = null;

	// --- Change batching ---

	#pendingChanges: Change[] | null = null;
	#changeBatchScheduled = false;
	// Tracks consecutive onChange invocations where the hook scheduled
	// another tick (i.e. wrote back into the scope synchronously). Used
	// to detect runaway re-entry loops that would otherwise freeze the
	// page silently in the microtask queue.
	#consecutiveOnChangeReschedules = 0;

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
		this.asyncStates = new Map();
		this.validationStates = new Map();
		this.#factoryPipes = new Map();

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
			// `read`/`readTracked` actually return for plain.
			if (meta.kind === 'plain') {
				this.#plainValues.set(slot, processed);
			}

			// Initialize validation state for schema slots
			if (meta.kind === 'schema' && meta.schema) {
				this.validationStates.set(
					slot,
					signal(runValidation(meta.schema, processed)),
				);
			}
		}

		// Activate factory pipes for every slot whose pipeline contains a
		// factory step. Without this, factory pipes inside scope definitions
		// (pipeDebounce / pipeThrottle / pipeBatch / ...) are silently dead:
		// `write()` only routes through `#factoryPipes.get(slot)` when populated,
		// and `#applySyncPipeline` stops at the first factory — so a
		// `value('').pipe(pipeDebounce(300))` field would fire immediately
		// instead of debouncing. Standalone `Value.pipe(factory)` already
		// self-activates in `value.ts`; this brings scope slots to parity.
		for (let slot = 0; slot < definition.slotCount; slot++) {
			const meta = definition.slots[slot]!;
			if (
				meta.pipeline &&
				meta.pipeline.some((step) => step.kind === 'factory')
			) {
				this.activateFactoryPipes(slot);
			}
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
		// Build reverse map for O(1) lookup in change context
		this.#slotByNode = new Map();
		for (const [slot, node] of nodesBySlot) {
			this.#slotByNode.set(node, slot);
		}
	}

	/**
	 * Read a slot's current value without tracking. Plain slots bypass the
	 * signal entirely and read from {@link #plainValues}.
	 */
	read(slot: number): unknown {
		if (this.definition.slots[slot]!.kind === 'plain') {
			return this.#plainValues.get(slot);
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
			return this.#plainValues.get(slot);
		}
		return this.signals[slot]!.value;
	}

	/**
	 * Write a value to a slot, running through the pipeline and change hooks.
	 */
	write(slot: number, value: unknown): void {
		if (this.destroyed) return;

		const meta = this.definition.slots[slot]!;

		// Check for factory pipes
		const factories = this.#factoryPipes.get(slot);
		if (factories && factories.length > 0) {
			// Apply sync steps before the first factory, then hand off
			let current = value;
			if (meta.pipeline) {
				for (const step of meta.pipeline) {
					if (step.kind === 'factory') break;
					current = step.transform(current);
				}
			}
			factories[0]!.write(current);
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
	 */
	_writeToSignal(slot: number, value: unknown): void {
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
		if (this.beforeChangeHook && this.#instanceRoot) {
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
			const validationSignal = this.validationStates.get(slot);
			if (validationSignal) {
				validationSignal.value = runValidation(meta.schema, value);
			}
		}

		// Queue onChange
		if (this.onChangeHook) {
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
		const recomputeFn = this._recomputeFns.get(slot);
		if (recomputeFn) recomputeFn();
	}

	/** @internal — registered by scope instance creation */
	readonly _recomputeFns: Map<number, () => void> = new Map();

	/**
	 * Read validation state for a schema slot.
	 */
	readValidation(slot: number): ValidationState<unknown, unknown> {
		const validationSignal = this.validationStates.get(slot);
		return validationSignal ?
				validationSignal.peek()
			:	{ isValid: true, value: this.read(slot), issues: [] };
	}

	/**
	 * Subscribe to validation state changes for a schema slot.
	 */
	subscribeValidation(slot: number, fn: () => void): Unsubscribe {
		const validationSignal = this.validationStates.get(slot);
		if (!validationSignal) return () => {};
		return subscribeFireOnly(() => {
			void validationSignal.value;
		}, fn);
	}

	/**
	 * Read async state for a slot.
	 */
	readAsync(slot: number): AsyncState<unknown> {
		const asyncSignal = this.asyncStates.get(slot);
		return asyncSignal ? asyncSignal.peek() : initialAsyncState();
	}

	/**
	 * Subscribe to async state changes for a slot.
	 * Fires when the async state transitions (setting, set, error).
	 */
	subscribeAsyncState(slot: number, fn: () => void): Unsubscribe {
		const asyncSignal = this.asyncStates.get(slot);
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

		const factorySteps = meta.pipeline.filter((s) => s.kind === 'factory');
		if (factorySteps.length === 0) return;

		const factories: ActiveFactoryPipe[] = [];
		let factoryIndex = 0;

		for (let i = 0; i < meta.pipeline.length; i++) {
			const step = meta.pipeline[i]!;
			if (step.kind !== 'factory') continue;

			// Collect sync steps after this factory until next factory or end
			const syncStepsAfter: DefinitionPipeStep[] = [];
			for (let j = i + 1; j < meta.pipeline.length; j++) {
				const nextStep = meta.pipeline[j]!;
				if (nextStep.kind === 'factory') break;
				syncStepsAfter.push(nextStep);
			}

			const isLastFactory = factoryIndex === factorySteps.length - 1;
			const currentFactoryIndex = factoryIndex;
			const cleanups: (() => void)[] = [];

			const write = step.descriptor.create({
				set: (factoryOutput: unknown) => {
					let current = factoryOutput;
					for (const syncStep of syncStepsAfter) {
						if (syncStep.kind === 'sync') {
							current = syncStep.transform(current);
						}
					}

					if (isLastFactory) {
						this._writeToSignal(slot, current);
					} else {
						factories[currentFactoryIndex + 1]?.write(current);
					}
				},
				onCleanup: (fn: () => void) => {
					cleanups.push(fn);
				},
			});

			factories.push({ write, cleanups });
			factoryIndex++;
		}

		this.#factoryPipes.set(slot, factories);
	}

	/**
	 * Destroy this instance. Abort async work, run factory cleanups.
	 */
	destroy(): void {
		this.destroyed = true;

		// Clean up factory pipes
		for (const [, factories] of this.#factoryPipes) {
			for (const factory of factories) {
				for (const cleanup of factory.cleanups) cleanup();
			}
		}
		this.#factoryPipes.clear();
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

		for (const change of changes) {
			// Add to the field's own scope node
			const existing = changesByScope.get(change.scope);
			if (existing) {
				existing.push(change);
			} else {
				changesByScope.set(change.scope, [change]);
			}

			// Bubble up to ancestor groups via O(1) reverse lookup
			const slotIndex = this.#slotByNode.get(change.scope);
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
			this.onChangeHook({
				scope: this.#instanceRoot!,
				changes,
				changesByScope,
			});

			// Detect re-entry loops. If the hook wrote back into the scope,
			// `#changeBatchScheduled` was flipped back to `true` during the
			// call. Count consecutive ticks where that happens; after a
			// threshold, break the loop (drop the pending writes and
			// cancel the next scheduled tick) and log a diagnostic. The
			// underlying signal writes have already landed — only the
			// follow-up `onChange` call is suppressed.
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the onChangeHook call above can synchronously re-enter and flip this back to true
			if (this.#changeBatchScheduled) {
				this.#consecutiveOnChangeReschedules++;
				if (this.#consecutiveOnChangeReschedules >= ONCHANGE_RESCHEDULE_LIMIT) {
					console.error(
						`valuse: onChange has scheduled itself ${String(ONCHANGE_RESCHEDULE_LIMIT)}+ ` +
							'times in a row. This usually means an onChange callback ' +
							'is writing back into the scope and creating an infinite loop. ' +
							'Suppressing further onChange invocations for this loop.',
					);
					this.#pendingChanges = null;
					this.#changeBatchScheduled = false;
					this.#consecutiveOnChangeReschedules = 0;
				}
			} else {
				this.#consecutiveOnChangeReschedules = 0;
			}
		});
	}
}
