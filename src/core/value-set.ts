import { signal, type Signal } from './signal.js';
import { subscribeWithPrevious } from './utils/effect-helpers.js';
import { DisposerBag } from './utils/disposer-bag.js';
import { applyTransforms } from './utils/pipe-internal.js';
import { draftSet } from './draft.js';
import type { Comparator, Transform, Unsubscribe } from './types.js';
import { reactiveSnapshot } from './react-bridge.js';

/**
 * Reactive wrapper around a `Set<T>`.
 *
 * @remarks
 * `ValueSet` provides a reactive interface for a collection of unique items.
 * It supports draft-based mutations, transforms, custom comparison, and subscriptions.
 *
 * @typeParam T - the element type.
 *
 * @example
 * ```ts
 * const tags = valueSet(["react", "signals"]);
 * tags.add("valuse");
 * tags.has("valuse"); // true
 * ```
 */
export class ValueSet<T> {
	#signal: Signal<Set<T>>;
	readonly #transforms: Transform<Set<T>>[] = [];
	#comparator: Comparator<Set<T>> | undefined;
	readonly #bag = new DisposerBag();

	/** @internal */
	constructor(initial: Set<T>) {
		this.#signal = signal(initial);
	}

	/**
	 * Read the current `Set`.
	 * @returns the current `Set` instance.
	 */
	get(): Set<T> {
		return this.#signal.value;
	}

	/**
	 * Replace the set, or mutate it via a draft callback.
	 *
	 * @param valueOrFn - a new `Set` instance, or a function that receives a draft
	 * for in-place mutation.
	 *
	 * @example
	 * ```ts
	 * tags.set(new Set(["a", "b"]));
	 * tags.set(draft => {
	 *   draft.add("c");
	 *   draft.delete("a");
	 * });
	 * ```
	 */
	set(valueOrFn: Set<T> | ((draft: Set<T>) => void)): void {
		if (this.#bag.destroyed) return;
		const previous = this.get();
		let next: Set<T>;
		if (typeof valueOrFn === 'function') {
			next = draftSet(previous, valueOrFn);
		} else {
			next = valueOrFn;
		}
		next = applyTransforms(this.#transforms, next);
		if (next === previous) return;
		if (this.#comparator && this.#comparator(previous, next)) return;
		this.#signal.value = next;
	}

	/**
	 * Check if the set contains a value.
	 * @param value - the value to check.
	 * @returns `true` if the value exists.
	 */
	has(value: T): boolean {
		return this.get().has(value);
	}

	/** Number of elements. */
	get size(): number {
		return this.get().size;
	}

	/**
	 * Return all elements as an array.
	 * @returns the current elements.
	 */
	values(): T[] {
		return [...this.get()];
	}

	/** Remove all elements. */
	clear(): void {
		if (this.#bag.destroyed) return;
		// No-op if already empty. Without this guard `clear()` on an empty
		// set still assigned a fresh `new Set()`, firing subscribers for a
		// state that didn't change (parallel to the valueMap fix).
		if (this.#signal.peek().size === 0) return;
		this.#signal.value = new Set<T>();
	}

	/**
	 * Delete an element from the set.
	 * @param value - the value to remove.
	 * @returns `true` if the value was present.
	 */
	delete(value: T): boolean {
		if (this.#bag.destroyed) return false;
		const previous = this.get();
		if (!previous.has(value)) return false;
		const next = new Set(previous);
		next.delete(value);
		this.#signal.value = next;
		return true;
	}

	/**
	 * Add an element to the set. No-op if already present.
	 * @param value - the value to add.
	 * @returns `this` for chaining.
	 */
	add(value: T): this {
		if (this.#bag.destroyed) return this;
		const previous = this.get();
		if (previous.has(value)) return this;
		const next = new Set(previous);
		next.add(value);
		this.#signal.value = next;
		return this;
	}

	/**
	 * Subscribe to set changes.
	 *
	 * @param fn - callback fired with the new and previous sets on each change.
	 * @returns an {@link Unsubscribe} function.
	 */
	subscribe(fn: (value: Set<T>, previous: Set<T>) => void): Unsubscribe {
		return this.#bag.attach(
			subscribeWithPrevious(
				() => this.#signal.value,
				() => this.#signal.peek(),
				fn,
			),
		);
	}

	/**
	 * Add a transform that runs on every `set()` call.
	 * @param transform - function that receives and returns a set.
	 * @returns `this` for chaining.
	 */
	pipe(transform: Transform<Set<T>>): this {
		this.#transforms.push(transform);
		this.#signal.value = applyTransforms(this.#transforms, this.#signal.value);
		return this;
	}

	/**
	 * Override the default identity comparison. When the comparator returns
	 * `true`, the update is skipped and subscribers are not notified.
	 * @param comparator - function that returns `true` if two sets are equal.
	 * @returns `this` for chaining.
	 */
	compareUsing(comparator: Comparator<Set<T>>): this {
		this.#comparator = comparator;
		return this;
	}

	/**
	 * React hook. Returns `[set, setter]`.
	 * Re-renders the component on any set change.
	 * @returns a `[Set, setter]` tuple.
	 */
	use(): [Set<T>, (value: Set<T> | ((draft: Set<T>) => void)) => void] {
		const snapshot = reactiveSnapshot(
			this,
			(onChange) => this.subscribe(onChange),
			() => this.get(),
		);
		return [
			snapshot,
			(valueOrFn) => {
				this.set(valueOrFn);
			},
		];
	}

	/**
	 * Dispose all subscriptions.
	 *
	 * After destroy, reads still return the last value, writes are no-ops,
	 * and existing subscribers stop firing. Idempotent.
	 */
	destroy(): void {
		this.#bag.destroy();
	}
}

/**
 * Create a reactive set.
 *
 * @param initial - optional initial items as an array or Set.
 * @typeParam T - the element type.
 * @returns a new {@link ValueSet} instance.
 */
export function valueSet<T>(initial?: T[] | Set<T>): ValueSet<T> {
	return new ValueSet(new Set(initial));
}
