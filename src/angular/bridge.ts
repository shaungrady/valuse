/**
 * Angular signals bridge for valuse.
 *
 * Adapts any reactive valuse source into a read-only Angular signal. Updates
 * are pushed into a `signal` on every change, and cleanup is registered through
 * the current `DestroyRef` (or one resolved from a provided `Injector`), so the
 * subscription is torn down when the host component or service is destroyed.
 *
 */

import {
	DestroyRef,
	inject,
	type Injector,
	type Signal,
	signal,
} from '@angular/core';
import {
	type BridgeSource,
	type BridgeValue,
	normalizeSource,
} from '../core/bridge-source.js';

/**
 * Options for {@link valuseSignal}.
 */
export interface ValuseSignalOptions {
	/**
	 * Injector used to resolve `DestroyRef` for cleanup. Provide this when
	 * calling outside an injection context (e.g. lazily, after construction).
	 */
	injector?: Injector;
	/**
	 * Skip automatic cleanup. When `true`, no `DestroyRef` is required and the
	 * subscription lives until the source itself is destroyed. Useful outside
	 * Angular's DI (e.g. tests) or when managing lifetime manually.
	 */
	manualCleanup?: boolean;
}

/**
 * Read a reactive valuse source as a read-only Angular signal that updates on
 * change. Mutate the source directly (e.g. `value.set(...)`) to write.
 *
 * Must run in an injection context (constructor or field initializer) unless an
 * `injector` is supplied or `manualCleanup` is set.
 *
 * @param source - any valuse reactive (`Value`, `ValueSchema`, collections, or
 * a scope instance).
 * @param options - cleanup configuration.
 * @returns a read-only signal tracking the source's current value.
 *
 * @example
 * ```ts
 * import { valuseSignal } from 'valuse/angular';
 *
 * class CartComponent {
 *   readonly total = valuseSignal(cart.total);
 * }
 * ```
 */
export function valuseSignal<S extends BridgeSource<unknown>>(
	source: S,
	options?: ValuseSignalOptions,
): Signal<BridgeValue<S>> {
	const { getSnapshot, subscribe } = normalizeSource(source);
	// Resolve the cleanup hook before subscribing: a missing injection context
	// throws here (where `inject` is documented to run) instead of after the
	// subscription is created, which would leak it on the error path.
	let destroyRef: DestroyRef | undefined;
	if (!options?.manualCleanup) {
		destroyRef =
			options?.injector ? options.injector.get(DestroyRef) : inject(DestroyRef);
	}
	const state = signal(getSnapshot());
	const unsubscribe = subscribe(() => {
		state.set(getSnapshot());
	});
	destroyRef?.onDestroy(unsubscribe);
	return state.asReadonly();
}
