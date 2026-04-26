import type { ScopeTemplate } from '../../core/value-scope.js';

/** A pluggable storage backend for `withPersistence`. */
export interface PersistenceAdapter {
	/** Read stored data. Returns `null` if nothing is stored. */
	read: (key: string) => string | null | Promise<string | null>;

	/** Write data to storage. */
	write: (key: string, data: string) => void | Promise<void>;

	/** Remove stored data. */
	remove: (key: string) => void | Promise<void>;

	/**
	 * Subscribe to external changes (e.g. cross-tab storage events).
	 * Returns an unsubscribe function. Optional — adapters that don't
	 * support external change notifications (sessionStorage, IndexedDB)
	 * should omit this.
	 */
	subscribe?: (key: string, fn: (data: string | null) => void) => () => void;
}

/** Options for {@link withPersistence}. */
export interface PersistenceOptions {
	/** Storage key. Required. */
	key: string;

	/** Storage adapter. Required. */
	adapter: PersistenceAdapter;

	/**
	 * Which fields to persist. Defaults to all fields in the snapshot.
	 * Sync derivations are skipped (they recompute on hydration) unless
	 * explicitly listed.
	 */
	fields?: string[];

	/** Custom serializer. Default: `JSON.stringify`. */
	serialize?: (snapshot: Record<string, unknown>) => string;

	/** Custom deserializer. Default: `JSON.parse`. */
	deserialize?: (raw: string) => Record<string, unknown>;

	/**
	 * Throttle writes to storage in milliseconds. Default: `0`
	 * (write on every change).
	 */
	throttle?: number;
}

interface PersistenceState {
	/** True while hydrating from storage, to suppress write-back. */
	isHydrating: boolean;
	/** Pending throttled-write timer. */
	writeTimer: ReturnType<typeof setTimeout> | null;
	/** Most recent snapshot queued for a throttled write. */
	pendingSnapshot: Record<string, unknown> | null;
	/** Cross-tab subscription cleanup, if registered. */
	externalUnsubscribe: (() => void) | null;
	/** Write a snapshot directly to the adapter (through `pickFields`). */
	writeNow: (snapshot: Record<string, unknown>) => void;
	/** Current snapshot getter, bound to the instance. */
	getSnapshot: () => Record<string, unknown>;
}

/**
 * Per-instance persistence state, keyed by scope instance.
 * Using a WeakMap avoids polluting the instance with a `__persistence` property.
 */
const persistenceByInstance = new WeakMap<object, PersistenceState>();

function pickFields(
	snapshot: Record<string, unknown>,
	fields: string[] | undefined,
): Record<string, unknown> {
	if (!fields) return snapshot;
	const filtered: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in snapshot) {
			filtered[field] = snapshot[field];
		}
	}
	return filtered;
}

/**
 * Wrap a scope template with persistence to a storage backend.
 *
 * On `create`, reads from the adapter and hydrates the instance.
 * On each change, writes the selected fields back to storage
 * (throttled if configured). On `destroy`, flushes pending writes
 * and tears down any cross-tab subscription.
 *
 * @param template - the scope template to persist.
 * @param options - persistence options (`key` and `adapter` required).
 * @returns a new {@link ScopeTemplate} with persistence wired in.
 */
export function withPersistence<Def extends Record<string, unknown>>(
	template: ScopeTemplate<Def>,
	options: PersistenceOptions,
): ScopeTemplate<Def> {
	const {
		key,
		adapter,
		fields,
		serialize = JSON.stringify,
		deserialize = JSON.parse as (raw: string) => Record<string, unknown>,
		throttle = 0,
	} = options;

	function parseOrNull(raw: string | null): Record<string, unknown> | null {
		if (raw === null) return null;
		let parsed: unknown;
		try {
			parsed = deserialize(raw);
		} catch {
			return null;
		}
		// Reject non-object payloads (primitives, arrays, null) — snapshots are
		// always plain-object shaped, so anything else is a corrupt payload.
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return null;
		}
		return parsed as Record<string, unknown>;
	}

	function flush(
		state: PersistenceState,
		writeNow: (snapshot: Record<string, unknown>) => void,
	): void {
		if (state.writeTimer !== null) {
			clearTimeout(state.writeTimer);
			state.writeTimer = null;
		}
		if (state.pendingSnapshot !== null) {
			const snapshot = state.pendingSnapshot;
			state.pendingSnapshot = null;
			writeNow(snapshot);
		}
	}

	return template.extend(
		{},
		{
			onCreate({ scope }) {
				function writeNow(snapshot: Record<string, unknown>): void {
					const selected = pickFields(snapshot, fields);
					try {
						void adapter.write(key, serialize(selected));
					} catch {
						// Ignore write errors (quota, SSR, etc.)
					}
				}

				const state: PersistenceState = {
					isHydrating: false,
					writeTimer: null,
					pendingSnapshot: null,
					externalUnsubscribe: null,
					writeNow,
					getSnapshot: () => scope.$getSnapshot(),
				};
				persistenceByInstance.set(scope, state);

				function hydrateFrom(raw: string | null): void {
					const parsed = parseOrNull(raw);
					if (!parsed) return;
					state.isHydrating = true;
					try {
						scope.$setSnapshot(parsed);
					} finally {
						// Defer the flag reset so the synchronous onChange
						// that follows setSnapshot sees isHydrating = true.
						queueMicrotask(() => {
							state.isHydrating = false;
						});
					}
				}

				// Hydrate. If adapter.read is async, await it in the background.
				try {
					const readResult = adapter.read(key);
					if (readResult instanceof Promise) {
						readResult
							.then((raw) => {
								hydrateFrom(raw);
							})
							.catch(() => {
								// Ignore read errors.
							});
					} else {
						hydrateFrom(readResult);
					}
				} catch {
					// Ignore sync read errors.
				}

				// Cross-tab / external subscription.
				if (adapter.subscribe) {
					state.externalUnsubscribe = adapter.subscribe(key, (raw) => {
						hydrateFrom(raw);
					});
				}
			},

			onChange({ scope }) {
				const state = persistenceByInstance.get(scope);
				if (!state) return;
				if (state.isHydrating) return;

				const snapshot = state.getSnapshot();

				if (throttle > 0) {
					state.pendingSnapshot = snapshot;
					if (state.writeTimer === null) {
						state.writeTimer = setTimeout(() => {
							state.writeTimer = null;
							const pending = state.pendingSnapshot;
							state.pendingSnapshot = null;
							if (pending) state.writeNow(pending);
						}, throttle);
					}
				} else {
					state.writeNow(snapshot);
				}
			},

			onDestroy({ scope }) {
				const state = persistenceByInstance.get(scope);
				if (!state) return;

				flush(state, state.writeNow);

				if (state.externalUnsubscribe) {
					state.externalUnsubscribe();
					state.externalUnsubscribe = null;
				}

				persistenceByInstance.delete(scope);
			},
		},
	);
}
