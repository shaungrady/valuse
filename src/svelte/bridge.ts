/**
 * Svelte store bridge for valuse.
 *
 * Adapts any reactive valuse source into Svelte's store contract so it can be
 * read with the `$store` auto-subscription syntax. Svelte stores must emit the
 * current value to each new subscriber immediately; valuse's `subscribe` only
 * fires on change, so the adapter pushes the snapshot once up front, then
 * forwards every subsequent change.
 *
 */

import type { Readable, Writable } from 'svelte/store';
import {
	type BridgeSource,
	type BridgeValue,
	normalizeSource,
	type WritableSource,
} from '../core/bridge-source.js';

/**
 * Wrap a reactive valuse source as a read-only Svelte store.
 *
 * @param source - any valuse reactive (`Value`, `ValueSchema`, collections, or
 * a scope instance).
 * @returns a Svelte {@link Readable} usable with `$store` syntax.
 *
 * @example
 * ```svelte
 * <script>
 *   import { toStore } from 'valuse/svelte';
 *   const name = toStore(user.name);
 * </script>
 * <p>{$name}</p>
 * ```
 */
export function toStore<S extends BridgeSource<unknown>>(
	source: S,
): Readable<BridgeValue<S>> {
	const { getSnapshot, subscribe } = normalizeSource(source);
	return {
		subscribe(run) {
			run(getSnapshot());
			return subscribe(() => {
				run(getSnapshot());
			});
		},
	};
}

/**
 * Wrap a writable valuse source (`Value` / `ValueSchema`) as a two-way Svelte
 * store, so `$store = next` and `bind:value` write back through the source.
 *
 * @param source - a writable valuse reactive.
 * @returns a Svelte {@link Writable}.
 *
 * @example
 * ```svelte
 * <script>
 *   import { toWritableStore } from 'valuse/svelte';
 *   const name = toWritableStore(user.name);
 * </script>
 * <input bind:value={$name} />
 * ```
 */
export function toWritableStore<T>(source: WritableSource<T>): Writable<T> {
	const { subscribe } = toStore(source);
	return {
		subscribe,
		set(value) {
			source.set(value);
		},
		update(updater) {
			source.set((previous) => updater(previous));
		},
	};
}
