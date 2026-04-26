import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { indexedDBAdapter } from '../middleware/persistence/indexedDBAdapter.js';
import { withPersistence } from '../middleware/persistence/persistence.js';

// Each test gets a fresh database name so fake-indexeddb doesn't leak state.
let dbCounter = 0;
function freshDbName(): string {
	dbCounter += 1;
	return `test-db-${dbCounter}-${Date.now()}`;
}

describe('indexedDBAdapter', () => {
	it('writes and reads back', async () => {
		const adapter = indexedDBAdapter({ dbName: freshDbName() });
		await adapter.write('greeting', 'hello');
		const result = await adapter.read('greeting');
		expect(result).toBe('hello');
	});

	it('read returns null for missing keys', async () => {
		const adapter = indexedDBAdapter({ dbName: freshDbName() });
		const result = await adapter.read('missing');
		expect(result).toBeNull();
	});

	it('remove deletes a stored entry', async () => {
		const adapter = indexedDBAdapter({ dbName: freshDbName() });
		await adapter.write('k', 'v');
		expect(await adapter.read('k')).toBe('v');
		await adapter.remove('k');
		expect(await adapter.read('k')).toBeNull();
	});

	it('respects a custom storeName', async () => {
		const dbName = freshDbName();
		const custom = indexedDBAdapter({ dbName, storeName: 'custom-store' });
		await custom.write('k', 'stored-in-custom');
		expect(await custom.read('k')).toBe('stored-in-custom');
	});

	it('isolates data across database names', async () => {
		const a = indexedDBAdapter({ dbName: freshDbName() });
		const b = indexedDBAdapter({ dbName: freshDbName() });

		await a.write('k', 'from-a');
		await b.write('k', 'from-b');

		expect(await a.read('k')).toBe('from-a');
		expect(await b.read('k')).toBe('from-b');
	});

	it('has no subscribe method (no cross-context events)', () => {
		const adapter = indexedDBAdapter({ dbName: freshDbName() });
		expect(adapter.subscribe).toBeUndefined();
	});

	it('returns null when indexedDB is unavailable (SSR)', async () => {
		// Simulate SSR / old browser by stripping the global.
		const scope = globalThis as { indexedDB?: IDBFactory };
		const original = scope.indexedDB;
		delete scope.indexedDB;
		try {
			const adapter = indexedDBAdapter({ dbName: freshDbName() });
			expect(await adapter.read('k')).toBeNull();
			// write and remove silently no-op.
			await expect(adapter.write('k', 'v')).resolves.toBeUndefined();
			await expect(adapter.remove('k')).resolves.toBeUndefined();
		} finally {
			if (original !== undefined) scope.indexedDB = original;
		}
	});

	it('tolerates non-string stored values by returning null', async () => {
		// Manually seed the store with a non-string value to exercise the
		// guard in read().
		const dbName = freshDbName();
		const storeName = 'valuse';
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(dbName, 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(storeName);
			};
			request.onsuccess = () => {
				const db = request.result;
				const tx = db.transaction(storeName, 'readwrite');
				tx.objectStore(storeName).put({ not: 'a string' }, 'bad-key');
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			request.onerror = () => reject(request.error);
		});

		const adapter = indexedDBAdapter({ dbName });
		expect(await adapter.read('bad-key')).toBeNull();
	});
});

describe('withPersistence + indexedDBAdapter', () => {
	beforeEach(() => {
		// Silence unhandled rejection warnings from fake-indexeddb during rapid teardown.
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('hydrates an instance from IndexedDB after the async read resolves', async () => {
		const dbName = freshDbName();
		const key = 'prefs';

		// Seed data using a separate adapter instance.
		const seed = indexedDBAdapter({ dbName });
		await seed.write(key, JSON.stringify({ theme: 'dark', fontSize: 18 }));

		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
		});
		const persisted = withPersistence(prefs, {
			key,
			adapter: indexedDBAdapter({ dbName }),
		});
		const instance = persisted.create({ theme: 'light', fontSize: 12 });

		// Before hydration resolves, the input values apply.
		expect(instance.theme.get()).toBe('light');

		// Drain the microtask queue enough times for the async read to resolve.
		for (let i = 0; i < 20; i += 1) {
			await new Promise((r) => setTimeout(r, 0));
		}

		expect(instance.theme.get()).toBe('dark');
		expect(instance.fontSize.get()).toBe(18);
	});

	it('writes changes through to IndexedDB', async () => {
		const dbName = freshDbName();
		const key = 'prefs';

		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, {
			key,
			adapter: indexedDBAdapter({ dbName }),
		});
		const instance = persisted.create({ theme: 'light' });

		instance.theme.set('dark');
		// Wait for onChange microtask + async write.
		for (let i = 0; i < 20; i += 1) {
			await new Promise((r) => setTimeout(r, 0));
		}

		const verifier = indexedDBAdapter({ dbName });
		const raw = await verifier.read(key);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw!)).toEqual({ theme: 'dark' });
	});
});
