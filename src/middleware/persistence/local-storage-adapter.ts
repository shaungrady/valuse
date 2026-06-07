import type { PersistenceAdapter } from './persistence.js';
import {
	createWebStorageAdapter,
	createWebStorageGetter,
} from './web-storage.js';

/**
 * Synchronous `localStorage` adapter. SSR-safe: returns `null` / no-ops when
 * `localStorage` is unavailable. Supports cross-tab sync via `storage` events.
 */
export const localStorageAdapter: PersistenceAdapter = createWebStorageAdapter({
	getStorage: createWebStorageGetter('localStorage'),
	subscribable: true,
});
