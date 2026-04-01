/**
 * Returns `true` when two values should be considered equal, causing the update to be skipped.
 *
 * @param a - the current value
 * @param b - the incoming value
 * @returns `true` to skip the update, `false` to apply it
 *
 * @see {@link Value.compareUsing} for usage on values
 * @see {@link ValueSet.compareUsing} for usage on sets
 * @see {@link ValueMap.compareUsing} for usage on maps
 */
export type Comparator<T> = (a: T, b: T) => boolean;

/**
 * A function that transforms a value before it is stored.
 * Applied on every `.set()` call, in the order transforms were added via `.pipe()`.
 *
 * @param value - the incoming value to transform
 * @returns the transformed value
 *
 * @see {@link Value.pipe} for usage on values
 */
export type Transform<T> = (value: T) => T;

/**
 * Call to stop listening for changes. Returned by all `.subscribe()` methods.
 *
 * @example
 * ```ts
 * const unsub = name.subscribe((v) => console.log(v));
 * unsub(); // stop listening
 * ```
 */
export type Unsubscribe = () => void;

/**
 * A setter that accepts a direct value or a `prev => next` callback.
 * Returned as the second element of `.use()` tuples.
 *
 * @example
 * ```ts
 * const [count, setCount] = counter.use();
 * setCount(5);
 * setCount((prev) => prev + 1);
 * ```
 */
export type Setter<T> = (value: T | ((prev: T) => T)) => void;
