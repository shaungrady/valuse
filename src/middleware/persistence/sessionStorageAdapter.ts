import type { PersistenceAdapter } from './persistence.js';

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
 * No cross-tab sync (no `subscribe`).
 */
export const sessionStorageAdapter: PersistenceAdapter = {
	read(key: string): string | null {
		const storage = getStorage();
		if (!storage) return null;
		try {
			return storage.getItem(key);
		} catch {
			return null;
		}
	},

	write(key: string, data: string): void {
		const storage = getStorage();
		if (!storage) return;
		try {
			storage.setItem(key, data);
		} catch {
			// Silently drop.
		}
	},

	remove(key: string): void {
		const storage = getStorage();
		if (!storage) return;
		try {
			storage.removeItem(key);
		} catch {
			// Silently drop.
		}
	},
};
