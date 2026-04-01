import { signal, effect, type Signal } from './signal.js';
import { getReactHooks, stableSubscribe } from './react-bridge.js';
import type { Comparator, Transform, Unsubscribe, Setter } from './types.js';

/**
 * A single piece of reactive state.
 *
 * Wraps a signal with transforms, custom comparison, subscriptions,
 * and an optional React hook via `.use()`.
 *
 * @typeParam T - the type of the stored value
 *
 * @example
 * ```ts
 * const name = value<string>("Alice");
 * name.get();        // "Alice"
 * name.set("Bob");
 * name.set((prev) => prev.toUpperCase());
 * ```
 *
 * @see {@link value} factory function for creating instances
 * @see {@link ValueSet} for reactive Sets
 * @see {@link ValueMap} for reactive Maps
 */
export class Value<T> {
	private _signal: Signal<T>;
	private readonly _transforms: Transform<T>[] = [];
	private _comparator: Comparator<T> | undefined;
	private readonly _disposers: (() => void)[] = [];

	/** @param initial - the initial value to store */
	constructor(initial: T) {
		this._signal = signal(initial);
	}

	/**
	 * Read the current value.
	 * @returns the current value
	 */
	get(): T {
		return this._signal.value;
	}

	/**
	 * Write a new value, or derive the next value from the previous one.
	 *
	 * @param valueOrFn - a direct value, or a callback receiving the previous value
	 *
	 * @example
	 * ```ts
	 * count.set(5);
	 * count.set((prev) => prev + 1);
	 * ```
	 */
	set(valueOrFn: T | ((prev: T) => T)): void {
		const previous = this.get();
		const raw =
			typeof valueOrFn === 'function'
				? (valueOrFn as (prev: T) => T)(previous)
				: valueOrFn;
		const next = this._applyTransforms(raw);

		if (this._comparator && this._comparator(previous, next)) {
			return;
		}

		this._signal.value = next;
	}

	/**
	 * Listen for changes. The callback fires on every update after subscription.
	 *
	 * @param fn - called with the new value on each change
	 * @returns an {@link Unsubscribe} function to stop listening
	 *
	 * @example
	 * ```ts
	 * const unsub = name.subscribe((v) => console.log(v));
	 * name.set("Bob"); // logs "Bob"
	 * unsub();
	 * ```
	 */
	subscribe(fn: (value: T) => void): Unsubscribe {
		// effect() runs once immediately to establish tracking — skip that first call
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
	 * Add a transform that runs on every `.set()` call.
	 * Transforms are applied in order. Chainable.
	 *
	 * @param transform - a function that receives and returns the value
	 * @returns `this` for chaining
	 *
	 * @example
	 * ```ts
	 * const email = value("")
	 *   .pipe((v) => v.trim())
	 *   .pipe((v) => v.toLowerCase());
	 * ```
	 */
	pipe(transform: Transform<T>): this {
		this._transforms.push(transform);
		// Re-apply transforms so the initial value is also transformed
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
	 * const user = value({ id: 1, name: "Alice" }).compareUsing(
	 *   (a, b) => a.id === b.id,
	 * );
	 * ```
	 */
	compareUsing(comparator: Comparator<T>): this {
		this._comparator = comparator;
		return this;
	}

	/**
	 * React hook. Returns `[value, setter]`.
	 * Re-renders the component when the value changes.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported. Outside React, returns a non-reactive snapshot.
	 *
	 * @returns a `[value, setter]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [name, setName] = name.use();
	 * setName("Bob");
	 * setName((prev) => prev.toUpperCase());
	 * ```
	 */
	use(): [T, Setter<T>] {
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
	 * The value remains readable but will no longer notify subscribers.
	 */
	destroy(): void {
		for (const dispose of this._disposers) dispose();
		this._disposers.length = 0;
	}

	/** @internal */
	private _applyTransforms(value: T): T {
		return this._transforms.reduce(
			(current, transform) => transform(current),
			value,
		);
	}
}

// --- Factory overloads ---

/**
 * Create a reactive value with no default. `.get()` returns `T | undefined`.
 *
 * @typeParam T - the type of the stored value
 *
 * @example
 * ```ts
 * const name = value<string>();
 * name.get(); // undefined
 * ```
 */
export function value<T>(): Value<T | undefined>;
/**
 * Create a reactive value with a default.
 *
 * @typeParam T - the type of the stored value (inferred from `initial`)
 * @param initial - the initial value
 *
 * @example
 * ```ts
 * const count = value(0);
 * count.get(); // 0
 * ```
 */
export function value<T>(initial: T): Value<T>;
// Implementation
export function value<T>(initial?: T): Value<T | undefined> {
	return new Value(initial);
}
