import { signal, type Signal } from '@preact/signals-core';
import type { ScopeTemplate } from '../core/value-scope.js';
import type { ScopeInstance, ValueInputOf } from '../core/scope-types.js';
import type { Unsubscribe } from '../core/types.js';

/** Options for {@link withHistory}. */
export interface HistoryOptions {
	/**
	 * Maximum number of history entries to retain. Default: `50`.
	 * Oldest entries are dropped when the limit is exceeded.
	 */
	maxDepth?: number;

	/**
	 * Which fields to track. Default: all fields in the snapshot.
	 * Derivations are typically omitted since they recompute from tracked state.
	 */
	fields?: string[];

	/**
	 * Merge rapid changes into a single history entry. Changes landing within
	 * `batchMs` ms of each other are collapsed. Default: `0` (every change is
	 * a separate entry).
	 */
	batchMs?: number;
}

/** Undo/redo methods added to each scope instance by `withHistory`. */
export interface HistoryInstance {
	/** Restore the previous snapshot. No-op at the beginning of history. */
	undo: () => void;

	/** Restore the next snapshot. No-op at the end of history. */
	redo: () => void;

	/** `true` when undo is available. Reactive. */
	readonly canUndo: boolean;

	/** `true` when redo is available. Reactive. */
	readonly canRedo: boolean;

	/** Drop all history entries. */
	clearHistory: () => void;
}

/**
 * A template returned by `withHistory`. Produces instances that include the
 * standard `ScopeInstance<Def>` API plus {@link HistoryInstance} methods.
 */
export interface HistoryTemplate<Def extends Record<string, unknown>> {
	create(
		input?: Partial<ValueInputOf<Def>>,
	): ScopeInstance<Def> & HistoryInstance;
}

interface HistoryState {
	stack: Signal<Record<string, unknown>[]>;
	position: Signal<number>;
	canUndoSignal: Signal<boolean>;
	canRedoSignal: Signal<boolean>;
	/** Set while undo/redo/clearHistory is running so the subscriber
	 *  doesn't record a new entry. */
	isRestoring: boolean;
	/** Pending batch timer, if a batch window is open. */
	batchTimer: ReturnType<typeof setTimeout> | null;
	/** Unsubscribe from $subscribe set up in onCreate. */
	unsubscribe: Unsubscribe | null;
}

/**
 * Per-instance history state, keyed by scope instance.
 * Using a WeakMap avoids polluting the instance with a `__history` property.
 */
const historyByInstance = new WeakMap<object, HistoryState>();

function pickFields(
	snapshot: Record<string, unknown>,
	fields: string[] | undefined,
): Record<string, unknown> {
	if (!fields) return { ...snapshot };
	const filtered: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in snapshot) {
			filtered[field] = snapshot[field];
		}
	}
	return filtered;
}

function snapshotsEqual(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const k of aKeys) {
		if (!Object.is(a[k], b[k])) return false;
	}
	return true;
}

/**
 * Wrap a scope template with undo/redo. Each instance gains `undo`, `redo`,
 * `canUndo`, `canRedo`, and `clearHistory`.
 *
 * @param template - the scope template to instrument.
 * @param options - history options.
 * @returns a template whose instances include {@link HistoryInstance}.
 */
export function withHistory<Def extends Record<string, unknown>>(
	template: ScopeTemplate<Def>,
	options: HistoryOptions = {},
): HistoryTemplate<Def> {
	const { maxDepth = 50, fields, batchMs = 0 } = options;

	const extended = template.extend(
		{},
		{
			onCreate({ scope }) {
				const initialSnapshot = pickFields(scope.$getSnapshot(), fields);

				const stack = signal([initialSnapshot]);
				const position = signal(0);
				const canUndoSignal = signal(false);
				const canRedoSignal = signal(false);

				function refreshCanFlags(): void {
					canUndoSignal.value = position.value > 0;
					canRedoSignal.value = position.value < stack.value.length - 1;
				}

				const state: HistoryState = {
					stack,
					position,
					canUndoSignal,
					canRedoSignal,
					isRestoring: false,
					batchTimer: null,
					unsubscribe: null,
				};
				historyByInstance.set(scope, state);

				function pushEntry(snapshot: Record<string, unknown>): void {
					const currentStack = stack.value;
					const currentPosition = position.value;
					// Truncate any forward history on a new write.
					let nextStack = currentStack.slice(0, currentPosition + 1);
					nextStack.push(snapshot);
					let nextPosition = nextStack.length - 1;
					// Enforce maxDepth by dropping oldest entries.
					if (nextStack.length > maxDepth) {
						const excess = nextStack.length - maxDepth;
						nextStack = nextStack.slice(excess);
						nextPosition = nextStack.length - 1;
					}
					stack.value = nextStack;
					position.value = nextPosition;
					refreshCanFlags();
				}

				function replaceTop(snapshot: Record<string, unknown>): void {
					const currentStack = stack.value;
					const currentPosition = position.value;
					// Also truncate any forward history, in case user hit a key
					// inside the batch window after undoing.
					const nextStack = currentStack.slice(0, currentPosition + 1);
					nextStack[nextStack.length - 1] = snapshot;
					stack.value = nextStack;
					position.value = nextStack.length - 1;
					refreshCanFlags();
				}

				function recordChange(): void {
					if (state.isRestoring) return;
					const snapshot = pickFields(scope.$getSnapshot(), fields);

					// Skip if snapshot matches the current top (no-op change).
					const topIndex = position.value;
					const top = stack.value[topIndex];
					if (top && snapshotsEqual(top, snapshot)) return;

					if (batchMs > 0) {
						if (state.batchTimer !== null) {
							replaceTop(snapshot);
						} else {
							pushEntry(snapshot);
							state.batchTimer = setTimeout(() => {
								state.batchTimer = null;
							}, batchMs);
						}
					} else {
						pushEntry(snapshot);
					}
				}

				state.unsubscribe = scope.$subscribe(recordChange);

				// Attach HistoryInstance methods to the scope instance.
				Object.defineProperty(scope, 'canUndo', {
					configurable: true,
					enumerable: true,
					get: () => canUndoSignal.value,
				});
				Object.defineProperty(scope, 'canRedo', {
					configurable: true,
					enumerable: true,
					get: () => canRedoSignal.value,
				});

				scope.undo = () => {
					const p = position.value;
					if (p <= 0) return;
					state.isRestoring = true;
					try {
						const target = stack.value[p - 1];
						if (target) scope.$setSnapshot(target);
						position.value = p - 1;
						refreshCanFlags();
					} finally {
						state.isRestoring = false;
					}
				};

				scope.redo = () => {
					const p = position.value;
					if (p >= stack.value.length - 1) return;
					state.isRestoring = true;
					try {
						const target = stack.value[p + 1];
						if (target) scope.$setSnapshot(target);
						position.value = p + 1;
						refreshCanFlags();
					} finally {
						state.isRestoring = false;
					}
				};

				scope.clearHistory = () => {
					state.isRestoring = true;
					try {
						const current = pickFields(scope.$getSnapshot(), fields);
						stack.value = [current];
						position.value = 0;
						if (state.batchTimer !== null) {
							clearTimeout(state.batchTimer);
							state.batchTimer = null;
						}
						refreshCanFlags();
					} finally {
						state.isRestoring = false;
					}
				};
			},

			onDestroy({ scope }) {
				const state = historyByInstance.get(scope);
				if (!state) return;
				if (state.batchTimer !== null) {
					clearTimeout(state.batchTimer);
					state.batchTimer = null;
				}
				if (state.unsubscribe) {
					state.unsubscribe();
					state.unsubscribe = null;
				}
				historyByInstance.delete(scope);
				delete scope.undo;
				delete scope.redo;
				delete scope.clearHistory;
			},
		},
	);

	return extended as unknown as HistoryTemplate<Def>;
}
