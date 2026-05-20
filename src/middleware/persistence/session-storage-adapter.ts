import type { PersistenceAdapter } from './persistence.js';
import { createWebStorageAdapter } from './web-storage.js';

function getStorage(): Storage | null {
	if (typeof globalThis === 'undefined' || !('sessionStorage' in globalThis)) {
		return null;
	}
	try {
		return (globalThis as { sessionStorage: Storage }).sessionStorage;
	} catch {
		return null;
	}
}

/**
 * Synchronous `sessionStorage` adapter. Scoped to the current tab. SSR-safe.
 * No cross-tab sync (storage events don't fire for sessionStorage).
 */
export const sessionStorageAdapter: PersistenceAdapter =
	createWebStorageAdapter({ getStorage });
