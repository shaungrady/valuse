/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { signal, effect, type Signal } from './signal.js';
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
 * Per-instance data store. Holds signals and manages the write pipeline,
 * change tracking, and subscriptions. All field wrappers delegate to this.
 *
 * Static metadata (paths, pipelines, comparators) lives on the shared
 * {@link ScopeDefinitionMeta}, not duplicated here.
 *
 * @internal
 */
export class InstanceStore {
	/** One signal per reactive slot. */
	readonly signals: Signal<unknown>[];

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
		this.signals = new Array(definition.slotCount) as Signal<unknown>[];
		for (let slot = 0; slot < definition.slotCount; slot++) {
			const meta = definition.slots[slot]!;
			const initial =
				initialValues.has(slot) ? initialValues.get(slot) : meta.defaultValue;

			if (meta.kind === 'asyncDerived') {
				const hasSeed = initialValues.has(slot);
				this.asyncStates.set(
					slot,
					signal(hasSeed ? resolvedAsyncState(initial) : initialAsyncState()),
				);
			}

			// Apply sync pipeline to initial value
			const processed =
				meta.pipeline ?
					this.#applySyncPipeline(initial, meta.pipeline)
				:	initial;

			this.signals[slot] = signal(processed);

			// Initialize validation state for schema slots
			if (meta.kind === 'schema' && meta.schema) {
				this.validationStates.set(
					slot,
					signal(runValidation(meta.schema, processed)),
				);
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
	 * Read a slot's current value without tracking.
	 */
	read(slot: number): unknown {
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
	 * computed/effect).
	 */
	readTracked(slot: number): unknown {
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
	 */
	_writeToSignal(slot: number, value: unknown): void {
		const meta = this.definition.slots[slot]!;
		const previous = this.signals[slot]!.peek();

		// Plain slots: write directly, no comparator or change tracking
		if (meta.kind === 'plain') {
			this.signals[slot]!.value = value;
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

		let isFirstRun = true;
		let previousValue = this.signals[slot]!.peek();
		const dispose = effect(() => {
			const currentValue = this.signals[slot]!.value;
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			const prev = previousValue;
			previousValue = currentValue;
			fn(currentValue, prev);
		});

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
		let isFirstRun = true;
		const dispose = effect(() => {
			void validationSignal.value;
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			fn();
		});
		return dispose;
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
		let isFirstRun = true;
		const dispose = effect(() => {
			void asyncSignal.value;
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			fn();
		});
		return dispose;
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
		});
	}
}
