/**
 * Framework-agnostic normalization for host-framework bridges.
 *
 * Every reactive valuse type exposes a read + subscribe pair: value-like types
 * (`Value`, `ValueSchema`, `ValueArray`, `ValueSet`, `ValueMap`) use
 * `get()`/`subscribe()`, while scope instances use `$getSnapshot()`/`$subscribe()`.
 * The Svelte, Vue, and Angular bridges all consume the same uniform shape, so
 * the per-shape detection lives here once instead of in each adapter.
 *
 * @internal
 */

import type { Unsubscribe } from './types.js';

/**
 * Value-like reactive source: a `get()` reader and a change `subscribe()`.
 * Implemented by `Value`, `ValueSchema`, `ValueArray`, `ValueSet`, `ValueMap`.
 *
 * @typeParam T - the value returned by `get()`.
 */
interface ValueLikeSource<T> {
	get(): T;
	subscribe(fn: (value: T, previous: T) => void): Unsubscribe;
}

/**
 * Scope-instance reactive source: the `$`-prefixed snapshot + subscribe pair.
 *
 * @typeParam T - the snapshot returned by `$getSnapshot()`.
 */
interface ScopeLikeSource<T> {
	$getSnapshot(): T;
	$subscribe(fn: () => void): Unsubscribe;
}

/**
 * Any reactive valuse source a framework bridge can consume.
 *
 * @typeParam T - the value/snapshot read from the source.
 */
export type BridgeSource<T> = ValueLikeSource<T> | ScopeLikeSource<T>;

/**
 * The value type read from a {@link BridgeSource}.
 *
 * @typeParam S - the source type.
 */
export type BridgeValue<S> =
	S extends ValueLikeSource<infer T> ? T
	: S extends ScopeLikeSource<infer T> ? T
	: never;

/**
 * A value-like source that can also be written through a `Setter`-shaped
 * `set()`. Matches `Value<T>` and `ValueSchema<T>`; the two-way Svelte/Vue
 * adapters accept this so writes flow back to the source.
 *
 * @typeParam T - the value read and written.
 */
export interface WritableSource<T> extends ValueLikeSource<T> {
	set(value: T | ((previous: T) => T)): void;
}

/**
 * The uniform read/subscribe pair every bridge adapter builds on. `subscribe`
 * takes a zero-arg listener that fires on each change; the adapter re-reads via
 * `getSnapshot`. Mirrors the contract `reactiveSnapshot` uses for React.
 *
 * @typeParam T - the value read from the source.
 * @internal
 */
export interface NormalizedSource<T> {
	getSnapshot: () => T;
	subscribe: (onChange: () => void) => Unsubscribe;
}

function isScopeLike(source: object): source is ScopeLikeSource<unknown> {
	return (
		typeof (source as Partial<ScopeLikeSource<unknown>>).$subscribe ===
			'function' &&
		typeof (source as Partial<ScopeLikeSource<unknown>>).$getSnapshot ===
			'function'
	);
}

/**
 * Normalize any reactive valuse source into a uniform `getSnapshot`/`subscribe`
 * pair, detecting the value-like vs scope-instance shape.
 *
 * @param source - the reactive source to bridge.
 * @returns the normalized read/subscribe pair.
 * @internal
 */
export function normalizeSource<S extends BridgeSource<unknown>>(
	source: S,
): NormalizedSource<BridgeValue<S>> {
	if (isScopeLike(source)) {
		return {
			getSnapshot: () => source.$getSnapshot() as BridgeValue<S>,
			subscribe: (onChange) => source.$subscribe(onChange),
		};
	}
	const valueSource = source as ValueLikeSource<BridgeValue<S>>;
	return {
		getSnapshot: () => valueSource.get(),
		subscribe: (onChange) => valueSource.subscribe(onChange),
	};
}
