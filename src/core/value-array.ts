import { signal, effect, type Signal } from './signal.js';
import type { Comparator, Transform, Unsubscribe } from './types.js';
import { getReactHooks, stableSubscribe } from './react-bridge.js';

/**
 * A reactive array. One signal holds the frozen array; per-index reactivity
 * is handled downstream via computed signals.
 *
 * @typeParam In - the element type accepted by mutations.
 * @typeParam Out - the element type returned by `get()` (defaults to `In`).
 *
 * @example
 * ```ts
 * const numbers = valueArray([1, 2, 3]);
 * numbers.push(4);
 * numbers.get(); // [1, 2, 3, 4]
 * numbers.get(0); // 1
 * ```
 *
 * @see {@link valueArray} factory function for creating instances.
 */
export class ValueArray<In, Out = In> {
	readonly #signal: Signal<readonly Out[]>;
	readonly #disposers = new Set<() => void>();
	#elementTransform: Transform<In, Out> | null = null;
	#elementComparator: Comparator<Out> | null = null;
	#destroyed = false;

	/** @internal */
	constructor(initial?: In[]) {
		const processed =
			initial ?
				Object.freeze(initial.map((item) => this.#transformElement(item)))
			:	Object.freeze([] as Out[]);
		this.#signal = signal(processed);
	}

	/**
	 * Read the full array (frozen).
	 * @returns the current frozen array.
	 */
	get(): readonly Out[];
	/**
	 * Read a single element by index (negative indices count from end).
	 * @param index - the element index.
	 * @returns the element, or `undefined` if out of bounds.
	 */
	get(index: number): Out | undefined;
	get(index?: number): readonly Out[] | Out | undefined {
		const arr = this.#signal.peek();
		if (index === undefined) return arr;
		const resolved = index < 0 ? arr.length + index : index;
		return arr[resolved];
	}

	/** Number of elements. */
	get length(): number {
		return this.#signal.peek().length;
	}

	/**
	 * Replace the entire array.
	 * @param array - the new array contents.
	 */
	set(array: In[]): void;
	/**
	 * Replace a single element by index.
	 * @param index - the element index.
	 * @param value - the new value.
	 */
	set(index: number, value: In): void;
	set(arrayOrIndex: In[] | number, value?: In): void {
		if (this.#destroyed) return;

		if (typeof arrayOrIndex === 'number') {
			const index = arrayOrIndex;
			const current = [...this.#signal.peek()];
			current[index] = this.#transformElement(value as In);
			this.#commitArray(current);
			return;
		}

		const newArray = arrayOrIndex.map((item) => this.#transformElement(item));
		this.#commitArray(newArray);
	}

	/**
	 * Append one or more elements.
	 * @param items - elements to append.
	 */
	push(...items: In[]): void {
		if (this.#destroyed) return;
		const current = this.#signal.peek();
		const transformed = items.map((item) => this.#transformElement(item));
		this.#commitArray([...current, ...transformed]);
	}

	/**
	 * Remove and return the last element.
	 * @returns the removed element, or `undefined` if the array is empty.
	 */
	pop(): Out | undefined {
		if (this.#destroyed) return undefined;
		const current = this.#signal.peek();
		if (current.length === 0) return undefined;
		const last = current[current.length - 1];
		this.#commitArray(current.slice(0, -1));
		return last;
	}

	/**
	 * Prepend one or more elements.
	 * @param items - elements to prepend.
	 */
	unshift(...items: In[]): void {
		if (this.#destroyed) return;
		const current = this.#signal.peek();
		const transformed = items.map((item) => this.#transformElement(item));
		this.#commitArray([...transformed, ...current]);
	}

	/**
	 * Remove and return the first element.
	 * @returns the removed element, or `undefined` if the array is empty.
	 */
	shift(): Out | undefined {
		if (this.#destroyed) return undefined;
		const current = this.#signal.peek();
		if (current.length === 0) return undefined;
		const first = current[0];
		this.#commitArray(current.slice(1));
		return first;
	}

	/**
	 * Remove and/or insert elements at a position.
	 * @param start - the index to begin changes.
	 * @param deleteCount - the number of elements to remove.
	 * @param items - elements to insert at `start`.
	 * @returns the removed elements.
	 */
	splice(start: number, deleteCount: number, ...items: In[]): Out[] {
		if (this.#destroyed) return [];
		const current = [...this.#signal.peek()];
		const transformed = items.map((item) => this.#transformElement(item));
		const removed = current.splice(start, deleteCount, ...transformed);
		this.#commitArray(current);
		return removed;
	}

	/**
	 * Keep only elements matching the predicate (in place).
	 * @param predicate - return `true` to keep the element.
	 */
	filter(predicate: (element: Out, index: number) => boolean): void {
		if (this.#destroyed) return;
		const current = this.#signal.peek();
		this.#commitArray(current.filter(predicate));
	}

	/**
	 * Transform all elements in place.
	 * @param transform - function that maps each element to a new value.
	 */
	map(transform: (element: Out, index: number) => Out): void {
		if (this.#destroyed) return;
		const current = this.#signal.peek();
		this.#commitArray(current.map(transform));
	}

	/**
	 * Sort the array in place.
	 * @param comparator - optional comparison function (same contract as `Array.sort`).
	 */
	sort(comparator?: (a: Out, b: Out) => number): void {
		if (this.#destroyed) return;
		const current = [...this.#signal.peek()];
		current.sort(comparator);
		this.#commitArray(current);
	}

	/** Reverse the array order. */
	reverse(): void {
		if (this.#destroyed) return;
		const current = [...this.#signal.peek()];
		current.reverse();
		this.#commitArray(current);
	}

	/**
	 * Swap two elements by index.
	 * @param indexA - first index.
	 * @param indexB - second index.
	 */
	swap(indexA: number, indexB: number): void {
		if (this.#destroyed) return;
		const current = [...this.#signal.peek()];
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const temp = current[indexA]!;
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		current[indexA] = current[indexB]!;
		current[indexB] = temp;
		this.#commitArray(current);
	}

	/**
	 * Subscribe to array changes.
	 *
	 * @param fn - callback fired with the new and previous arrays on each change.
	 * @returns an {@link Unsubscribe} function.
	 */
	subscribe(
		fn: (value: readonly Out[], previous: readonly Out[]) => void,
	): Unsubscribe {
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
	 * Add a per-element transform. Returns a new `ValueArray` with the
	 * transformed output type.
	 *
	 * @typeParam NewOut - the transformed element type.
	 * @param transform - function that maps each element.
	 * @returns a new {@link ValueArray} with transformed elements.
	 */
	pipeElement<NewOut>(
		transform: Transform<In, NewOut>,
	): ValueArray<In, NewOut> {
		const newArr = new ValueArray<In, NewOut>();
		newArr.#elementTransform = transform;
		// Apply transform to current contents
		const current = this.#signal.peek();
		const transformed = (current as unknown as In[]).map((item) =>
			transform(item),
		);
		newArr.#signal.value = Object.freeze(transformed);
		return newArr;
	}

	/**
	 * Override per-element comparison. When `set()` is called with a new array,
	 * the update is skipped if all elements compare equal.
	 *
	 * @param comparator - function that returns `true` if two elements are equal.
	 * @returns `this` for chaining.
	 */
	compareElementsUsing(comparator: Comparator<Out>): this {
		this.#elementComparator = comparator;
		return this;
	}

	/**
	 * React hook. Returns `[array, setter]`.
	 * Re-renders the component on any array change.
	 * @returns a `[frozenArray, setter]` tuple.
	 */
	use(): [readonly Out[], (array: In[]) => void];
	/**
	 * React hook for a single index. Returns `[element, setter]`.
	 * Re-renders only when the element at `index` changes.
	 * @param index - the element index to track.
	 * @returns a `[element, setter]` tuple.
	 */
	use(index: number): [Out | undefined, (value: In) => void];
	use(
		index?: number,
	):
		| [readonly Out[], (array: In[]) => void]
		| [Out | undefined, (value: In) => void] {
		const hooks = getReactHooks();
		if (hooks) {
			const subscribe = stableSubscribe(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			if (index !== undefined) {
				const snapshot = hooks.useSyncExternalStore(subscribe, () =>
					this.get(index),
				);
				return [
					snapshot,
					(value: In) => {
						this.set(index, value);
					},
				];
			}
			const snapshot = hooks.useSyncExternalStore(subscribe, () => this.get());
			return [
				snapshot,
				(array: In[]) => {
					this.set(array);
				},
			];
		}
		if (index !== undefined) {
			return [
				this.get(index),
				(value: In) => {
					this.set(index, value);
				},
			];
		}
		return [
			this.get(),
			(array: In[]) => {
				this.set(array);
			},
		];
	}

	/**
	 * Dispose all subscriptions.
	 */
	destroy(): void {
		this.#destroyed = true;
		for (const dispose of this.#disposers) dispose();
		this.#disposers.clear();
	}

	#transformElement(item: In): Out {
		if (this.#elementTransform) {
			return this.#elementTransform(item) as unknown as Out;
		}
		return item as unknown as Out;
	}

	#commitArray(newArray: Out[]): void {
		const frozen = Object.freeze(newArray);

		// Element-level comparison
		if (this.#elementComparator) {
			const current = this.#signal.peek();
			if (
				current.length === frozen.length &&
				current.every((element, index) =>
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					this.#elementComparator!(element, frozen[index]!),
				)
			) {
				return; // All elements compare equal, skip
			}
		}

		this.#signal.value = frozen;
	}
}

/**
 * Create a reactive array.
 *
 * @typeParam T - the element type.
 * @param initial - optional initial elements.
 * @returns a new {@link ValueArray} instance.
 *
 * @example
 * ```ts
 * const items = valueArray(["a", "b", "c"]);
 * items.push("d");
 * items.get(); // ["a", "b", "c", "d"]
 * ```
 */
export function valueArray<T>(initial?: T[]): ValueArray<T> {
	return new ValueArray<T>(initial);
}
