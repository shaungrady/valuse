import { signal, effect, type Signal } from './signal.js';
import { draftSet } from './draft.js';
import type { Comparator, Transform, Unsubscribe } from './types.js';
import { getReactHooks, stableSubscribe } from './react-bridge.js';

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
	readonly #disposers = new Set<() => void>();

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
		const previous = this.get();
		let next: Set<T>;
		if (typeof valueOrFn === 'function') {
			next = draftSet(previous, valueOrFn as (draft: Set<T>) => void);
		} else {
			next = valueOrFn;
		}
		next = this.#applyTransforms(next);
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
		this.#signal.value = new Set<T>();
	}

	/**
	 * Delete an element from the set.
	 * @param value - the value to remove.
	 * @returns `true` if the value was present.
	 */
	delete(value: T): boolean {
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
	 * @param transform - function that receives and returns a set.
	 * @returns `this` for chaining.
	 */
	pipe(transform: Transform<Set<T>>): this {
		this.#transforms.push(transform);
		this.#signal.value = this.#applyTransforms(this.#signal.value);
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
		const hooks = getReactHooks();
		if (hooks) {
			const subscribe = stableSubscribe(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			const snapshot = hooks.useSyncExternalStore(subscribe, () => this.get());
			return [
				snapshot,
				(valueOrFn) => {
					this.set(valueOrFn);
				},
			];
		}
		return [
			this.get(),
			(valueOrFn) => {
				this.set(valueOrFn);
			},
		];
	}

	/** Dispose all subscriptions. */
	destroy(): void {
		for (const dispose of this.#disposers) dispose();
		this.#disposers.clear();
	}

	#applyTransforms(value: Set<T>): Set<T> {
		return this.#transforms.reduce(
			(current, transform) => transform(current),
			value,
		);
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
