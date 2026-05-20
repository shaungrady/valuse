import type { PersistenceAdapter } from './persistence.js';

/** Options for {@link indexedDBAdapter}. */
export interface IndexedDBAdapterOptions {
	/** Database name. */
	dbName: string;
	/** Object store name. Default: `'valuse'`. */
	storeName?: string;
}

function hasIndexedDB(): boolean {
	return (
		typeof globalThis !== 'undefined' &&
		'indexedDB' in globalThis &&
		(globalThis as { indexedDB?: IDBFactory }).indexedDB !== undefined
	);
}

function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const idb = (globalThis as { indexedDB: IDBFactory }).indexedDB;
		const request = idb.open(dbName, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
			}
		};
		request.onsuccess = () => {
			resolve(request.result);
		};
		request.onerror = () => {
			reject(request.error ?? new Error('IndexedDB open failed'));
		};
	});
}

function txPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => {
			resolve(request.result);
		};
		request.onerror = () => {
			reject(request.error ?? new Error('IndexedDB request failed'));
		};
	});
}

/**
 * Async IndexedDB adapter. Creates the database and object store on first
 * use. Returns no-ops when `indexedDB` is unavailable (SSR, old browsers).
 * No cross-tab sync (no `subscribe`).
 *
 * @param options - `dbName` required, `storeName` defaults to `'valuse'`.
 */
export function indexedDBAdapter(
	options: IndexedDBAdapterOptions,
): PersistenceAdapter {
	const { dbName, storeName = 'valuse' } = options;

	let dbPromise: Promise<IDBDatabase> | null = null;

	function getDB(): Promise<IDBDatabase> | null {
		if (!hasIndexedDB()) return null;
		dbPromise ??= openDB(dbName, storeName);
		return dbPromise;
	}

	// Run `fn` inside a fresh transaction on the object store. Returns
	// `undefined` when IndexedDB is unavailable or any step throws — both
	// failures are non-fatal at the adapter contract level.
	async function withStore<T>(
		mode: IDBTransactionMode,
		fn: (store: IDBObjectStore) => Promise<T>,
	): Promise<T | undefined> {
		const db = getDB();
		if (!db) return undefined;
		try {
			const dbInstance = await db;
			const tx = dbInstance.transaction(storeName, mode);
			return await fn(tx.objectStore(storeName));
		} catch {
			return undefined;
		}
	}

	return {
		async read(key: string): Promise<string | null> {
			const result = await withStore('readonly', (store) =>
				txPromise<unknown>(store.get(key)),
			);
			return typeof result === 'string' ? result : null;
		},

		async write(key: string, data: string): Promise<void> {
			await withStore('readwrite', (store) => txPromise(store.put(data, key)));
		},

		async remove(key: string): Promise<void> {
			await withStore('readwrite', (store) => txPromise(store.delete(key)));
		},
	};
}
