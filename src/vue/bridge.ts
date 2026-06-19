/**
 * Vue composition-API bridge for valuse.
 *
 * Adapts any reactive valuse source into a Vue ref. Updates are pushed into a
 * `shallowRef` on every change, and the subscription is torn down via
 * `onScopeDispose`, so the composables clean up automatically when the
 * surrounding component or effect scope is disposed.
 *
 */

import {
	computed,
	onScopeDispose,
	readonly,
	type ShallowRef,
	shallowRef,
	type WritableComputedRef,
} from 'vue';
import {
	type BridgeSource,
	type BridgeValue,
	normalizeSource,
	type WritableSource,
} from '../core/bridge-source.js';

function trackedRef<T>(source: BridgeSource<T>): ShallowRef<T> {
	const { getSnapshot, subscribe } = normalizeSource(source);
	const state = shallowRef(getSnapshot());
	const unsubscribe = subscribe(() => {
		state.value = getSnapshot();
	});
	// Auto-dispose with the surrounding component/effect scope. Left without a
	// scope, Vue warns — the subscription would otherwise leak silently. Callers
	// that need an unscoped lifetime should subscribe to the source directly.
	onScopeDispose(unsubscribe);
	return state;
}

/**
 * Read a reactive valuse source as a read-only Vue ref that re-renders on
 * change. Call inside `setup()` (or an active effect scope) so the subscription
 * is cleaned up automatically.
 *
 * @param source - any valuse reactive (`Value`, `ValueSchema`, collections, or
 * a scope instance).
 * @returns a read-only ref tracking the source's current value.
 *
 * @example
 * ```ts
 * import { useValuse } from 'valuse/vue';
 * const name = useValuse(user.name); // Readonly<Ref<string>>
 * ```
 */
export function useValuse<S extends BridgeSource<unknown>>(
	source: S,
): Readonly<ShallowRef<BridgeValue<S>>> {
	return readonly(trackedRef(source)) as Readonly<ShallowRef<BridgeValue<S>>>;
}

/**
 * Bind a writable valuse source (`Value` / `ValueSchema`) to a writable Vue ref
 * for two-way binding (`v-model`). Reads track the source; writes flow back
 * through `set()`.
 *
 * @param source - a writable valuse reactive.
 * @returns a writable computed ref suitable for `v-model`.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useValuseModel } from 'valuse/vue';
 * const name = useValuseModel(user.name);
 * </script>
 * <template><input v-model="name" /></template>
 * ```
 */
export function useValuseModel<T>(
	source: WritableSource<T>,
): WritableComputedRef<T> {
	const state = trackedRef(source);
	return computed<T>({
		get: () => state.value,
		set: (value) => {
			source.set(value);
		},
	});
}
