import { signal, effect, type Signal } from './signal.js';
import { draftSet } from './draft.js';
import { getReactHooks, stableSubscribe } from './react-bridge.js';
import type { Comparator, Transform, Unsubscribe } from './types.js';

/**
 * Setter for a {@link ValueSet}. Accepts a new Set or a draft mutate callback.
 *
 * @example
 * ```ts
 * const [tags, setTags] = tags.use();
 * setTags(new Set(["a", "b"]));
 * setTags((draft) => draft.add("c"));
 * ```
 */
export type ValueSetSetter<T> = (
	value: Set<T> | ((draft: Set<T>) => void),
) => void;

/**
 * Reactive wrapper around a `Set<T>`.
 *
 * Supports draft-based mutations, transforms, custom comparison,
 * subscriptions, and an optional React hook via `.use()`.
 *
 * @typeParam T - the element type
 *
 * @example
 * ```ts
 * const tags = valueSet<string>(["admin", "active"]);
 * tags.has("admin");               // true
 * tags.set((draft) => draft.add("editor"));
 * tags.add("superuser");
 * tags.delete("admin");
 * ```
 *
 * @see {@link valueSet} factory function for creating instances
 * @see {@link Value} for scalar reactive state
 * @see {@link ValueMap} for reactive Maps
 */
export class ValueSet<T> {
	private _signal: Signal<Set<T>>;
	private readonly _transforms: Transform<Set<T>>[] = [];
	private _comparator: Comparator<Set<T>> | undefined;
	private readonly _disposers: (() => void)[] = [];

	/** @param initial - the initial Set */
	constructor(initial: Set<T>) {
		this._signal = signal(initial);
	}

	/**
	 * Read the current Set.
	 * @returns the current Set
	 */
	get(): Set<T> {
		return this._signal.value;
	}

	/**
	 * Replace the set, or mutate it via a draft callback.
	 *
	 * @remarks
	 * Draft callbacks receive an Immer-style proxy. Mutations are recorded,
	 * then applied to produce a new immutable Set. If nothing changed, the
	 * original Set is kept (no notification).
	 *
	 * @param valueOrFn - a new Set, or a callback that mutates a draft
	 *
	 * @example
	 * ```ts
	 * tags.set(new Set(["a", "b"]));
	 * tags.set((draft) => draft.add("c"));
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

		next = this._applyTransforms(next);

		if (next === previous) {
			return;
		}

		if (this._comparator && this._comparator(previous, next)) {
			return;
		}

		this._signal.value = next;
	}

	/**
	 * Check if the set contains a value.
	 * @param value - the value to check for
	 * @returns `true` if the value is in the set
	 */
	has(value: T): boolean {
		return this.get().has(value);
	}

	/** Number of elements in the set. */
	get size(): number {
		return this.get().size;
	}

	/**
	 * Return the set's values as an array.
	 * @returns an array of all elements
	 */
	values(): T[] {
		return [...this.get()];
	}

	/** Remove all elements from the set. */
	clear(): void {
		this._signal.value = new Set<T>();
	}

	/**
	 * Delete an element from the set.
	 * @param value - the element to remove
	 * @returns `true` if the element was present and removed
	 */
	delete(value: T): boolean {
		const previous = this.get();
		if (!previous.has(value)) return false;
		const next = new Set(previous);
		next.delete(value);
		this._signal.value = next;
		return true;
	}

	/**
	 * Add an element to the set. No-op if already present.
	 * @param value - the element to add
	 * @returns `this` for chaining
	 */
	add(value: T): this {
		const previous = this.get();
		if (previous.has(value)) return this;
		const next = new Set(previous);
		next.add(value);
		this._signal.value = next;
		return this;
	}

	/**
	 * Listen for changes. The callback fires on every update after subscription.
	 *
	 * @param fn - called with the new Set on each change
	 * @returns an {@link Unsubscribe} function to stop listening
	 *
	 * @example
	 * ```ts
	 * const unsub = tags.subscribe((set) => console.log(set.size));
	 * tags.add("new");  // logs 3
	 * unsub();
	 * ```
	 */
	subscribe(fn: (value: Set<T>) => void): Unsubscribe {
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
	 * @param transform - a function that receives and returns a Set
	 * @returns `this` for chaining
	 *
	 * @example
	 * ```ts
	 * const tags = valueSet<string>().pipe(
	 *   (s) => new Set([...s].map((t) => t.toLowerCase())),
	 * );
	 * ```
	 */
	pipe(transform: Transform<Set<T>>): this {
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
	 *
	 * @example
	 * ```ts
	 * const tags = valueSet<string>(["a"]).compareUsing(
	 *   (a, b) => a.size === b.size,
	 * );
	 * ```
	 */
	compareUsing(comparator: Comparator<Set<T>>): this {
		this._comparator = comparator;
		return this;
	}

	/**
	 * React hook. Returns `[Set<T>, setter]`.
	 * Re-renders the component when the set changes.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported. Outside React, returns a non-reactive snapshot.
	 *
	 * @returns a `[Set<T>, setter]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [tags, setTags] = tags.use();
	 * setTags((draft) => draft.add("editor"));
	 * ```
	 */
	use(): [Set<T>, ValueSetSetter<T>] {
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

	/**
	 * Dispose all active subscriptions created via `.subscribe()`.
	 * The set remains readable but will no longer notify subscribers.
	 */
	destroy(): void {
		for (const dispose of this._disposers) dispose();
		this._disposers.length = 0;
	}

	/** @internal */
	private _applyTransforms(value: Set<T>): Set<T> {
		return this._transforms.reduce(
			(current, transform) => transform(current),
			value,
		);
	}
}

/**
 * Create a reactive set, optionally from an array or existing Set.
 *
 * @typeParam T - the element type
 * @param initial - optional initial elements as an array or Set
 * @returns a new {@link ValueSet}
 *
 * @example
 * ```ts
 * const tags = valueSet<string>(["admin", "active"]);
 * const empty = valueSet<number>();
 * ```
 */
export function valueSet<T>(initial?: T[] | Set<T>): ValueSet<T> {
	return new ValueSet(new Set(initial));
}
