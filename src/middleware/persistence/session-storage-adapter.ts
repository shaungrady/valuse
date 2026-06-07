import type { PersistenceAdapter } from './persistence.js';
import {
	createWebStorageAdapter,
	createWebStorageGetter,
} from './web-storage.js';

/**
 * Synchronous `sessionStorage` adapter. Scoped to the current tab. SSR-safe.
 * No cross-tab sync (storage events don't fire for sessionStorage).
 */
export const sessionStorageAdapter: PersistenceAdapter =
	createWebStorageAdapter({
		getStorage: createWebStorageGetter('sessionStorage'),
	});
