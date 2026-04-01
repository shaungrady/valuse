import { signal, effect, type Signal } from './signal.js';
import { draftMap } from './draft.js';
import { getReactHooks, stableSubscribe } from './react-bridge.js';
import type { Comparator, Transform, Unsubscribe } from './types.js';

// Per-key subscribe cache: WeakMap<ValueMap, Map<key, SubscribeFn>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const perKeySubscribeCache = new WeakMap<object, Map<any, any>>();

/**
 * Setter for a {@link ValueMap}. Accepts a new Map or a draft mutate callback.
 *
 * @example
 * ```ts
 * const [scores, setScores] = scores.use();
 * setScores(new Map([["alice", 100]]));
 * setScores((draft) => draft.set("bob", 82));
 * ```
 */
export type ValueMapSetter<K, V> = (
	value: Map<K, V> | ((draft: Map<K, V>) => void),
) => void;

/**
 * Reactive wrapper around a `Map<K, V>`.
 *
 * Supports draft-based mutations, per-key subscriptions, transforms,
 * custom comparison, and an optional React hook via `.use()`.
 *
 * @typeParam K - the key type
 * @typeParam V - the value type
 *
 * @example
 * ```ts
 * const scores = valueMap<string, number>([["alice", 95]]);
 * scores.get("alice");                        // 95
 * scores.set((draft) => draft.set("bob", 82));
 * const [alice, setAlice] = scores.use("alice");
 * ```
 *
 * @see {@link valueMap} factory function for creating instances
 * @see {@link Value} for scalar reactive state
 * @see {@link ValueSet} for reactive Sets
 */
export class ValueMap<K, V> {
	private _signal: Signal<Map<K, V>>;
	private readonly _transforms: Transform<Map<K, V>>[] = [];
	private _comparator: Comparator<Map<K, V>> | undefined;
	private readonly _disposers: (() => void)[] = [];

	/** @param initial - the initial Map */
	constructor(initial: Map<K, V>) {
		this._signal = signal(initial);
	}

	/**
	 * Read the entire map.
	 * @returns the current Map
	 */
	get(): Map<K, V>;
	/**
	 * Read a single key's value.
	 * @param key - the key to look up
	 * @returns the value, or `undefined` if not found
	 */
	get(key: K): V | undefined;
	get(key?: K): Map<K, V> | V | undefined {
		const map = this._signal.value;
		if (arguments.length === 0) return map;
		return map.get(key as K);
	}

	/**
	 * Replace the map, or mutate it via a draft callback.
	 *
	 * @remarks
	 * Draft callbacks receive an Immer-style proxy. Mutations are recorded,
	 * then applied to produce a new immutable Map. If nothing changed, the
	 * original Map is kept (no notification).
	 *
	 * @param valueOrFn - a new Map, or a callback that mutates a draft
	 *
	 * @example
	 * ```ts
	 * scores.set(new Map([["alice", 100]]));
	 * scores.set((draft) => draft.set("alice", 100));
	 * ```
	 */
	set(valueOrFn: Map<K, V> | ((draft: Map<K, V>) => void)): void {
		const previous = this._signal.value;

		let next: Map<K, V>;
		if (typeof valueOrFn === 'function') {
			next = draftMap(previous, valueOrFn as (draft: Map<K, V>) => void);
		} else {
			next = valueOrFn;
		}

		next = this._applyTransforms(next);

		if (next === previous) return;
		if (this._comparator && this._comparator(previous, next)) return;

		this._signal.value = next;
	}

	/**
	 * Delete a key from the map.
	 * @param key - the key to remove
	 * @returns `true` if the key was present and removed
	 */
	delete(key: K): boolean {
		const previous = this._signal.value;
		if (!previous.has(key)) return false;
		const next = new Map(previous);
		next.delete(key);
		this._signal.value = next;
		return true;
	}

	/**
	 * Check if the map contains a key.
	 * @param key - the key to check for
	 * @returns `true` if the key exists
	 */
	has(key: K): boolean {
		return this._signal.value.has(key);
	}

	/** Number of entries in the map. */
	get size(): number {
		return this._signal.value.size;
	}

	/**
	 * Return all keys as an array.
	 * @returns an array of all keys
	 */
	keys(): K[] {
		return [...this._signal.value.keys()];
	}

	/**
	 * Return all values as an array.
	 * @returns an array of all values
	 */
	values(): V[] {
		return [...this._signal.value.values()];
	}

	/**
	 * Return all entries as an array of `[key, value]` tuples.
	 * @returns an array of `[K, V]` pairs
	 */
	entries(): [K, V][] {
		return [...this._signal.value.entries()];
	}

	/** Remove all entries from the map. */
	clear(): void {
		this._signal.value = new Map();
	}

	/**
	 * Listen for changes. The callback fires on every update after subscription.
	 *
	 * @param fn - called with the new Map on each change
	 * @returns an {@link Unsubscribe} function to stop listening
	 *
	 * @example
	 * ```ts
	 * const unsub = scores.subscribe((map) => console.log(map.size));
	 * scores.set((d) => d.set("charlie", 90));  // logs 3
	 * unsub();
	 * ```
	 */
	subscribe(fn: (value: Map<K, V>) => void): Unsubscribe {
		let isFirstRun = true;
		const dispose = effect(() => {
			const currentValue = this._signal.value;
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			fn(currentValue);
		});
		this._disposers.push(dispose);
		return () => {
			dispose();
			const index = this._disposers.indexOf(dispose);
			if (index !== -1) this._disposers.splice(index, 1);
		};
	}

	/**
	 * Add a transform that runs on every `.set()` call. Chainable.
	 *
	 * @param transform - a function that receives and returns a Map
	 * @returns `this` for chaining
	 */
	pipe(transform: Transform<Map<K, V>>): this {
		this._transforms.push(transform);
		this._signal.value = this._applyTransforms(this._signal.value);
		return this;
	}

	/**
	 * Override the default identity comparison. When the comparator returns
	 * `true`, the update is skipped and subscribers are not notified.
	 *
	 * @param comparator - returns `true` to skip the update
	 * @returns `this` for chaining
	 */
	compareUsing(comparator: Comparator<Map<K, V>>): this {
		this._comparator = comparator;
		return this;
	}

	/**
	 * React hook for the whole map. Returns `[Map<K,V>, setter]`.
	 * Re-renders the component on any change to the map.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported. Outside React, returns a non-reactive snapshot.
	 *
	 * @returns a `[Map<K,V>, setter]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [scores, setScores] = scores.use();
	 * ```
	 */
	use(): [Map<K, V>, ValueMapSetter<K, V>];
	/**
	 * React hook for a single key. Returns `[value, setter]`.
	 * Only re-renders when this specific key's value changes.
	 *
	 * @param key - the key to subscribe to
	 * @returns a `[V | undefined, setter]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [aliceScore, setAlice] = scores.use("alice");
	 * ```
	 */
	use(key: K): [V | undefined, (value: V) => void];
	use(
		key?: K,
	): [Map<K, V>, ValueMapSetter<K, V>] | [V | undefined, (value: V) => void] {
		const hooks = getReactHooks();
		if (hooks) {
			if (arguments.length === 0) {
				const subscribe = stableSubscribe(this, (onChange) =>
					this.subscribe(() => {
						onChange();
					}),
				);
				const snapshot = hooks.useSyncExternalStore(subscribe, () =>
					this.get(),
				);
				return [
					snapshot,
					(valueOrFn: Map<K, V> | ((draft: Map<K, V>) => void)) => {
						this.set(valueOrFn);
					},
				];
			}

			// Per-key subscription: only notify React when this key's value changes
			const targetKey = key as K;
			let subscribersByKey = perKeySubscribeCache.get(this) as
				| Map<K, (onChange: () => void) => () => void>
				| undefined;
			if (!subscribersByKey) {
				subscribersByKey = new Map();
				perKeySubscribeCache.set(this, subscribersByKey);
			}
			let keySubscribeFn = subscribersByKey.get(targetKey);
			if (!keySubscribeFn) {
				keySubscribeFn = (onChange: () => void) => {
					let previousValue = this.get(targetKey);
					return this.subscribe(() => {
						const currentValue = this.get(targetKey);
						if (currentValue !== previousValue) {
							previousValue = currentValue;
							onChange();
						}
					});
				};
				subscribersByKey.set(targetKey, keySubscribeFn);
			}
			hooks.useSyncExternalStore(keySubscribeFn, () => this.get(targetKey));
		}
		if (arguments.length === 0) {
			return [
				this.get(),
				(valueOrFn: Map<K, V> | ((draft: Map<K, V>) => void)) => {
					this.set(valueOrFn);
				},
			];
		}
		return [
			this.get(key as K),
			(newValue: V) => {
				this.set((draft) => {
					draft.set(key as K, newValue);
				});
			},
		];
	}

	/**
	 * React hook. Returns the current list of keys.
	 * Re-renders when entries are added or removed.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported.
	 *
	 * @returns an array of all keys
	 *
	 * @example
	 * ```tsx
	 * const keys = scores.useKeys();
	 * // Re-renders when a key is added or removed, but not when a value changes
	 * ```
	 */
	useKeys(): K[] {
		const hooks = getReactHooks();
		if (hooks) {
			const subscribe = stableSubscribe(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			hooks.useSyncExternalStore(subscribe, () => this.get());
		}
		return this.keys();
	}

	/**
	 * Dispose all active subscriptions created via `.subscribe()`.
	 * The map remains readable but will no longer notify subscribers.
	 */
	destroy(): void {
		for (const dispose of this._disposers) dispose();
		this._disposers.length = 0;
	}

	/** @internal */
	private _applyTransforms(value: Map<K, V>): Map<K, V> {
		return this._transforms.reduce(
			(current, transform) => transform(current),
			value,
		);
	}
}

/**
 * Create a reactive map, optionally from entries or an existing Map.
 *
 * @typeParam K - the key type
 * @typeParam V - the value type
 * @param entries - optional initial entries as `[K, V][]` or a `Map<K, V>`
 * @returns a new {@link ValueMap}
 *
 * @example
 * ```ts
 * const scores = valueMap<string, number>([["alice", 95], ["bob", 82]]);
 * const empty = valueMap<string, number>();
 * ```
 */
export function valueMap<K, V>(entries?: [K, V][] | Map<K, V>): ValueMap<K, V> {
	return new ValueMap(new Map(entries));
}
