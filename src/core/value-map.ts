import { signal, effect, type Signal } from './signal.js';
import { draftMap } from './draft.js';
import type { Comparator, Transform, Unsubscribe } from './types.js';
import {
	getReactHooks,
	stableSubscribe,
	versionedAdapter,
	perKeySubscribe,
} from './react-bridge.js';

/**
 * Reactive wrapper around a `Map<K, V>`.
 *
 * @remarks
 * `ValueMap` provides a reactive interface for a collection of key-value pairs.
 * It supports draft-based mutations, transforms, custom comparison, and both
 * whole-map and per-key subscriptions.
 *
 * @typeParam K - the key type.
 * @typeParam V - the value type.
 *
 * @example
 * ```ts
 * const scores = valueMap([["alice", 95], ["bob", 87]]);
 * scores.set(draft => draft.set("carol", 91));
 * scores.get("carol"); // 91
 * ```
 *
 * @see {@link valueMap} factory function for creating instances.
 */
export class ValueMap<K, V> {
	#signal: Signal<Map<K, V>>;
	readonly #transforms: Transform<Map<K, V>>[] = [];
	#comparator: Comparator<Map<K, V>> | undefined;
	readonly #disposers = new Set<() => void>();

	/** @internal */
	constructor(initial: Map<K, V>) {
		this.#signal = signal(initial);
	}

	/**
	 * Read the entire map.
	 * @returns the current `Map` instance.
	 */
	get(): Map<K, V>;
	/**
	 * Read a single key's value.
	 * @param key - the key to look up.
	 * @returns the value associated with the key, or `undefined` if not found.
	 */
	get(key: K): V | undefined;
	get(key?: K): Map<K, V> | V | undefined {
		const map = this.#signal.value;
		if (arguments.length === 0) return map;
		return map.get(key as K);
	}

	/**
	 * Replace the map, or mutate it via a draft callback.
	 *
	 * @param valueOrFn - a new `Map` instance, or a function that receives a draft
	 * for in-place mutation.
	 *
	 * @example
	 * ```ts
	 * registry.set(new Map([["x", 10]]));
	 * registry.set(draft => {
	 *   draft.set("y", 20);
	 *   draft.delete("x");
	 * });
	 * ```
	 */
	set(valueOrFn: Map<K, V> | ((draft: Map<K, V>) => void)): void {
		const previous = this.#signal.value;
		let next: Map<K, V>;
		if (typeof valueOrFn === 'function') {
			next = draftMap(previous, valueOrFn as (draft: Map<K, V>) => void);
		} else {
			next = valueOrFn;
		}
		next = this.#applyTransforms(next);
		if (next === previous) return;
		if (this.#comparator && this.#comparator(previous, next)) return;
		this.#signal.value = next;
	}

	/**
	 * Delete a key from the map.
	 * @param key - the key to remove.
	 * @returns `true` if the key was present.
	 */
	delete(key: K): boolean {
		const previous = this.#signal.value;
		if (!previous.has(key)) return false;
		const next = new Map(previous);
		next.delete(key);
		this.#signal.value = next;
		return true;
	}

	/**
	 * Check if the map contains a key.
	 * @param key - the key to check.
	 * @returns `true` if the key exists.
	 */
	has(key: K): boolean {
		return this.#signal.value.has(key);
	}

	/** Number of entries in the map. */
	get size(): number {
		return this.#signal.value.size;
	}

	/**
	 * Return all keys as an array.
	 * @returns the current key list.
	 */
	keys(): K[] {
		return [...this.#signal.value.keys()];
	}

	/**
	 * Return all values as an array.
	 * @returns the current value list.
	 */
	values(): V[] {
		return [...this.#signal.value.values()];
	}

	/**
	 * Return all entries as `[key, value]` tuples.
	 * @returns an array of entries.
	 */
	entries(): [K, V][] {
		return [...this.#signal.value.entries()];
	}

	/** Remove all entries. */
	clear(): void {
		this.#signal.value = new Map();
	}

	/**
	 * Subscribe to map changes.
	 *
	 * @param fn - callback fired with the new and previous maps on each change.
	 * @returns an {@link Unsubscribe} function.
	 */
	subscribe(fn: (value: Map<K, V>, previous: Map<K, V>) => void): Unsubscribe {
		let isFirstRun = true;
		let previousValue = this.#signal.peek();
		const dispose = effect(() => {
			const currentValue = this.#signal.value;
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			const prev = previousValue;
			previousValue = currentValue;
			fn(currentValue, prev);
		});
		this.#disposers.add(dispose);
		return () => {
			dispose();
			this.#disposers.delete(dispose);
		};
	}

	/**
	 * Add a transform that runs on every `set()` call.
	 * @param transform - function that receives and returns a map.
	 * @returns `this` for chaining.
	 */
	pipe(transform: Transform<Map<K, V>>): this {
		this.#transforms.push(transform);
		this.#signal.value = this.#applyTransforms(this.#signal.value);
		return this;
	}

	/**
	 * Override the default identity comparison. When the comparator returns
	 * `true`, the update is skipped and subscribers are not notified.
	 * @param comparator - function that returns `true` if two maps are equal.
	 * @returns `this` for chaining.
	 */
	compareUsing(comparator: Comparator<Map<K, V>>): this {
		this.#comparator = comparator;
		return this;
	}

	/**
	 * React hook for the whole map. Returns `[map, setter]`.
	 * Re-renders the component on any map change.
	 * @returns a `[Map, setter]` tuple.
	 */
	use(): [Map<K, V>, (value: Map<K, V> | ((draft: Map<K, V>) => void)) => void];
	/**
	 * React hook for a single key. Returns `[value, setter]`.
	 * Re-renders only when the value at `key` changes.
	 * @param key - the key to track.
	 * @returns a `[value, setter]` tuple.
	 */
	use(key: K): [V | undefined, (value: V) => void];
	use(
		key?: K,
	):
		| [Map<K, V>, (value: Map<K, V> | ((draft: Map<K, V>) => void)) => void]
		| [V | undefined, (value: V) => void] {
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
			// Per-key: only re-render when this specific key's value changes
			const k = key as K;
			const subscribe = perKeySubscribe(this, k, (onChange) =>
				this.subscribe((current, previous) => {
					if (current.get(k) !== previous.get(k)) onChange();
				}),
			);
			const snapshot = hooks.useSyncExternalStore(subscribe, () => this.get(k));
			return [
				snapshot,
				(newValue: V) => {
					this.set((draft) => draft.set(k, newValue));
				},
			];
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
				this.set((draft) => draft.set(key as K, newValue));
			},
		];
	}

	/**
	 * React hook. Returns the current list of keys.
	 * Re-renders when keys are added or removed.
	 * @returns an array of keys.
	 */
	useKeys(): K[] {
		const hooks = getReactHooks();
		if (hooks) {
			// keys() returns a new array each call; use versionedAdapter so the
			// snapshot (a version number) is referentially stable between changes.
			const adapter = versionedAdapter(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return this.keys();
	}

	/** Dispose all subscriptions. */
	destroy(): void {
		for (const dispose of this.#disposers) dispose();
		this.#disposers.clear();
	}

	#applyTransforms(value: Map<K, V>): Map<K, V> {
		return this.#transforms.reduce(
			(current, transform) => transform(current),
			value,
		);
	}
}

/**
 * Create a reactive map.
 *
 * @param entries - optional initial entries as an array of tuples or a Map.
 * @typeParam K - the key type.
 * @typeParam V - the value type.
 * @returns a new {@link ValueMap} instance.
 */
export function valueMap<K, V>(entries?: [K, V][] | Map<K, V>): ValueMap<K, V> {
	return new ValueMap(new Map(entries));
}
