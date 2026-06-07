import type { PersistenceAdapter } from './persistence.js';

/**
 * Resolve a Web Storage handle (localStorage / sessionStorage) safely. Returns
 * `null` in environments where the storage isn't available (SSR, sandboxed
 * iframes, etc.) or where access throws (Safari private mode historically).
 *
 * @internal
 */
type StorageGetter = () => Storage | null;

/**
 * Build a {@link StorageGetter} for a Web Storage global (`localStorage` /
 * `sessionStorage`). The whole guard runs inside try/catch: merely *accessing*
 * the global can throw (Safari private mode, sandboxed iframes), so the presence
 * check must be protected too — not just the read.
 *
 * @internal
 */
export function createWebStorageGetter(
	storageKey: 'localStorage' | 'sessionStorage',
): StorageGetter {
	return () => {
		try {
			if (typeof globalThis === 'undefined') return null;
			const storage = (
				globalThis as {
					localStorage?: Storage;
					sessionStorage?: Storage;
				}
			)[storageKey];
			return storage ?? null;
		} catch {
			return null;
		}
	};
}

/**
 * Subscribe to cross-tab `storage` events. Only meaningful for `localStorage`
 * (sessionStorage is per-tab and never fires storage events from elsewhere),
 * so opt-in via the factory's `subscribable` flag.
 *
 * @internal
 */
function subscribeToStorageEvents(
	key: string,
	fn: (data: string | null) => void,
): () => void {
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
}

/**
 * Build a synchronous Web Storage persistence adapter. The storage getter is
 * called on every operation so SSR environments (where the global resolves to
 * `null` early) and late-arriving environments behave the same.
 *
 * Read/write/remove failures (quota, permission, opaque origin) are
 * intentionally swallowed — persistence is best-effort, never a hard error.
 *
 * @internal
 */
export function createWebStorageAdapter({
	getStorage,
	subscribable = false,
}: {
	getStorage: StorageGetter;
	subscribable?: boolean;
}): PersistenceAdapter {
	const adapter: PersistenceAdapter = {
		read(key) {
			const storage = getStorage();
			if (!storage) return null;
			try {
				return storage.getItem(key);
			} catch {
				return null;
			}
		},
		write(key, data) {
			const storage = getStorage();
			if (!storage) return;
			try {
				storage.setItem(key, data);
			} catch {
				// Silently drop (quota, opaque origin, etc).
			}
		},
		remove(key) {
			const storage = getStorage();
			if (!storage) return;
			try {
				storage.removeItem(key);
			} catch {
				// Silently drop.
			}
		},
	};
	if (subscribable) {
		adapter.subscribe = subscribeToStorageEvents;
	}
	return adapter;
}
