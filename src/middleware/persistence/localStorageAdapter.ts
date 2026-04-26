import type { PersistenceAdapter } from './persistence.js';

function hasLocalStorage(): boolean {
	return (
		typeof globalThis !== 'undefined' &&
		'localStorage' in globalThis &&
		(globalThis as { localStorage?: Storage }).localStorage !== undefined
	);
}

function getStorage(): Storage | null {
	if (!hasLocalStorage()) return null;
	try {
		return (globalThis as { localStorage: Storage }).localStorage;
	} catch {
		return null;
	}
}

/**
 * Synchronous `localStorage` adapter. SSR-safe: returns `null` / no-ops when
 * `window` is unavailable. Supports cross-tab sync via `storage` events.
 */
export const localStorageAdapter: PersistenceAdapter = {
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
			// Quota or access errors — silently drop.
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

	subscribe(key: string, fn: (data: string | null) => void): () => void {
		if (
			typeof globalThis === 'undefined' ||
			!('addEventListener' in globalThis) ||
			typeof (globalThis as { addEventListener?: unknown }).addEventListener !==
				'function'
		) {
			return () => {};
		}
		const target = globalThis as typeof globalThis & {
			addEventListener: (
				type: 'storage',
				listener: (event: StorageEvent) => void,
			) => void;
			removeEventListener: (
				type: 'storage',
				listener: (event: StorageEvent) => void,
			) => void;
		};
		const handler = (event: StorageEvent): void => {
			if (event.key !== key) return;
			fn(event.newValue);
		};
		target.addEventListener('storage', handler);
		return () => {
			target.removeEventListener('storage', handler);
		};
	},
};
