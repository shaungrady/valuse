/**
 * Dependency-injection bridge for React integration.
 *
 * Importing `valuse/react` installs `useSyncExternalStore` here as a side-effect.
 * Core classes call {@link getReactHooks} in their `.use()` methods; if installed,
 * they use `useSyncExternalStore` for concurrent-safe subscriptions.
 * If not installed, `.use()` falls back to a non-reactive snapshot.
 *
 * @internal
 */

/** Minimal surface needed from React for the bridge to work. @internal */
export interface ReactHooks {
	useSyncExternalStore: <T>(
		subscribe: (onStoreChange: () => void) => () => void,
		getSnapshot: () => T,
	) => T;
}

let _reactHooks: ReactHooks | undefined;

/**
 * Install React hooks into the bridge. Called once by the React entry on import.
 * @param hooks - the React hooks to install
 * @internal
 */
export function installReact(hooks: ReactHooks): void {
	_reactHooks = hooks;
}

/**
 * Get the installed React hooks, or `undefined` if React integration is not active.
 * @returns the installed hooks, or `undefined`
 * @internal
 */
export function getReactHooks(): ReactHooks | undefined {
	return _reactHooks;
}

// --- Stable subscribe cache ---
// useSyncExternalStore re-subscribes when the subscribe function reference changes.
// We cache one subscribe adapter per reactive instance to keep it stable across renders.

/** @internal */
type SubscribeFn = (onStoreChange: () => void) => () => void;

const subscribeCache = new WeakMap<object, SubscribeFn>();

/**
 * Returns a stable (referentially identical) subscribe function for a reactive instance.
 * Prevents `useSyncExternalStore` from re-subscribing on every render.
 *
 * @param instance - the reactive object to cache against
 * @param createSubscription - factory that sets up the actual subscription
 * @returns a cached subscribe function suitable for `useSyncExternalStore`
 *
 * @internal
 */
export function stableSubscribe(
	instance: object,
	createSubscription: (onChange: () => void) => () => void,
): SubscribeFn {
	let cachedSubscribeFn = subscribeCache.get(instance);
	if (!cachedSubscribeFn) {
		cachedSubscribeFn = (onChange: () => void) => createSubscription(onChange);
		subscribeCache.set(instance, cachedSubscribeFn);
	}
	return cachedSubscribeFn;
}

// --- Version-based snapshot for collection types ---
// Scope instances and ScopeMap don't have a single value to snapshot;
// we use a version counter that increments on each notification.

/** @internal */
interface VersionedAdapter {
	subscribe: SubscribeFn;
	getSnapshot: () => number;
}

const versionCache = new WeakMap<object, VersionedAdapter>();

/**
 * Returns a version-based subscribe/getSnapshot pair for use with `useSyncExternalStore`.
 * Used for types that don't have a single snapshotable value (e.g., scope instances).
 * A version counter increments on each change, triggering React re-renders.
 *
 * @param instance - the reactive object to cache against
 * @param createSubscription - factory that sets up the actual subscription
 * @returns a cached adapter with `subscribe` and `getSnapshot` functions
 *
 * @internal
 */
export function versionedAdapter(
	instance: object,
	createSubscription: (onChange: () => void) => () => void,
): VersionedAdapter {
	let cachedAdapter = versionCache.get(instance);
	if (!cachedAdapter) {
		let version = 0;
		cachedAdapter = {
			subscribe: (onChange: () => void) => {
				return createSubscription(() => {
					version++;
					onChange();
				});
			},
			getSnapshot: () => version,
		};
		versionCache.set(instance, cachedAdapter);
	}
	return cachedAdapter;
}

// --- Per-key subscribe cache ---
// For ValueMap.use(key), we need a stable subscribe function per (instance, key) pair
// so that only changes to that specific key trigger re-renders.

const perKeySubscribeCache = new WeakMap<object, Map<unknown, SubscribeFn>>();

/**
 * Returns a stable subscribe function scoped to a specific key of a reactive instance.
 * Only fires when the value at that key changes.
 *
 * @param instance - the reactive map instance
 * @param key - the key to track
 * @param createSubscription - factory that sets up a key-filtered subscription
 * @returns a cached subscribe function suitable for `useSyncExternalStore`
 *
 * @internal
 */
export function perKeySubscribe(
	instance: object,
	key: unknown,
	createSubscription: (onChange: () => void) => () => void,
): SubscribeFn {
	let keyMap = perKeySubscribeCache.get(instance);
	if (!keyMap) {
		keyMap = new Map();
		perKeySubscribeCache.set(instance, keyMap);
	}
	let cachedFn = keyMap.get(key);
	if (!cachedFn) {
		cachedFn = (onChange: () => void) => createSubscription(onChange);
		keyMap.set(key, cachedFn);
	}
	return cachedFn;
}
