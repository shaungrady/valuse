import type { PersistenceAdapter } from './persistence.js';
import { createWebStorageAdapter } from './web-storage.js';

function getStorage(): Storage | null {
	// The whole guard runs inside try/catch: merely *accessing*
	// `globalThis.localStorage` can throw (Safari private mode, sandboxed
	// iframes), so the presence check must be protected too — not just the read.
	try {
		if (
			typeof globalThis === 'undefined' ||
			!('localStorage' in globalThis) ||
			(globalThis as { localStorage?: Storage }).localStorage === undefined
		) {
			return null;
		}
		return (globalThis as { localStorage: Storage }).localStorage;
	} catch {
		return null;
	}
}

/**
 * Synchronous `localStorage` adapter. SSR-safe: returns `null` / no-ops when
 * `localStorage` is unavailable. Supports cross-tab sync via `storage` events.
 */
export const localStorageAdapter: PersistenceAdapter = createWebStorageAdapter({
	getStorage,
	subscribable: true,
});
