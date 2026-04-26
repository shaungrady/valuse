import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import {
	withPersistence,
	type PersistenceAdapter,
} from '../middleware/persistence/persistence.js';

function memoryAdapter(
	initial: Record<string, string> = {},
): PersistenceAdapter & {
	store: Record<string, string | undefined>;
	writeSpy: ReturnType<typeof vi.fn>;
	removeSpy: ReturnType<typeof vi.fn>;
} {
	const store: Record<string, string | undefined> = { ...initial };
	const writeSpy = vi.fn();
	const removeSpy = vi.fn();
	return {
		store,
		writeSpy,
		removeSpy,
		read: (key) => (key in store ? (store[key] ?? null) : null),
		write: (key, data) => {
			store[key] = data;
			writeSpy(key, data);
		},
		remove: (key) => {
			store[key] = undefined;
			removeSpy(key);
		},
	};
}

describe('withPersistence', () => {
	it('hydrates from storage on create, stored values override input', () => {
		const adapter = memoryAdapter({
			prefs: JSON.stringify({ theme: 'dark', fontSize: 16 }),
		});
		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
		});
		const persisted = withPersistence(prefs, {
			key: 'prefs',
			adapter,
		});
		const instance = persisted.create({ theme: 'light', fontSize: 12 });

		expect(instance.theme.get()).toBe('dark');
		expect(instance.fontSize.get()).toBe(16);
	});

	it('falls back to create input when no stored data', () => {
		const adapter = memoryAdapter();
		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
		});
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light', fontSize: 12 });

		expect(instance.theme.get()).toBe('light');
		expect(instance.fontSize.get()).toBe(12);
	});

	it('writes to storage on change', async () => {
		const adapter = memoryAdapter();
		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
		});
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light', fontSize: 12 });

		instance.theme.set('dark');
		await Promise.resolve();

		expect(adapter.writeSpy).toHaveBeenCalled();
		const stored = JSON.parse(adapter.store.prefs!);
		expect(stored).toEqual({ theme: 'dark', fontSize: 12 });
	});

	it('hydration does not trigger a write back', async () => {
		const adapter = memoryAdapter({
			prefs: JSON.stringify({ theme: 'dark', fontSize: 16 }),
		});
		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
		});
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		persisted.create({ theme: 'light', fontSize: 12 });

		await Promise.resolve();
		await Promise.resolve();

		expect(adapter.writeSpy).not.toHaveBeenCalled();
	});

	it('respects fields option', async () => {
		const adapter = memoryAdapter();
		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
			lastOpened: value<number>(),
		});
		const persisted = withPersistence(prefs, {
			key: 'prefs',
			adapter,
			fields: ['theme', 'fontSize'],
		});
		const instance = persisted.create({
			theme: 'light',
			fontSize: 12,
			lastOpened: 1,
		});

		instance.theme.set('dark');
		await Promise.resolve();

		const stored = JSON.parse(adapter.store.prefs!);
		expect(stored).toEqual({ theme: 'dark', fontSize: 12 });
		expect(stored).not.toHaveProperty('lastOpened');
	});

	it('uses custom serialize / deserialize', async () => {
		const adapter = memoryAdapter();
		const serialize = vi.fn(
			(snapshot: Record<string, unknown>) => `v1::${JSON.stringify(snapshot)}`,
		);
		const deserialize = vi.fn(
			(raw: string) =>
				JSON.parse(raw.replace(/^v1::/, '')) as Record<string, unknown>,
		);

		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, {
			key: 'prefs',
			adapter,
			serialize,
			deserialize,
		});
		const instance = persisted.create({ theme: 'light' });
		instance.theme.set('dark');
		await Promise.resolve();

		expect(serialize).toHaveBeenCalled();
		expect(adapter.store.prefs).toMatch(/^v1::/);

		// Hydrate a second instance using deserialize.
		const instance2 = persisted.create({ theme: 'blue' });
		expect(deserialize).toHaveBeenCalled();
		expect(instance2.theme.get()).toBe('dark');
	});

	it('throttles writes when throttle > 0', async () => {
		vi.useFakeTimers();
		const adapter = memoryAdapter();
		const prefs = valueScope({ count: value<number>() });
		const persisted = withPersistence(prefs, {
			key: 'prefs',
			adapter,
			throttle: 100,
		});
		const instance = persisted.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);
		instance.count.set(3);
		await Promise.resolve();

		expect(adapter.writeSpy).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(adapter.writeSpy).toHaveBeenCalledTimes(1);
		const stored = JSON.parse(adapter.store.prefs!);
		expect(stored).toEqual({ count: 3 });

		vi.useRealTimers();
	});

	it('flushes pending throttled write on destroy', async () => {
		vi.useFakeTimers();
		const adapter = memoryAdapter();
		const prefs = valueScope({ count: value<number>() });
		const persisted = withPersistence(prefs, {
			key: 'prefs',
			adapter,
			throttle: 500,
		});
		const instance = persisted.create({ count: 0 });

		instance.count.set(42);
		await Promise.resolve();

		expect(adapter.writeSpy).not.toHaveBeenCalled();

		instance.$destroy();

		expect(adapter.writeSpy).toHaveBeenCalledTimes(1);
		const stored = JSON.parse(adapter.store.prefs!);
		expect(stored).toEqual({ count: 42 });

		vi.useRealTimers();
	});

	it('handles async adapters (IndexedDB-style)', async () => {
		const asyncStore: Record<string, string> = {
			prefs: JSON.stringify({ theme: 'dark' }),
		};
		const adapter: PersistenceAdapter = {
			read: (key) => Promise.resolve(asyncStore[key] ?? null),
			write: (key, data) => {
				asyncStore[key] = data;
				return Promise.resolve();
			},
			remove: (key) => {
				asyncStore[key] = undefined as unknown as string;
				return Promise.resolve();
			},
		};

		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light' });

		// Initially has the input value.
		expect(instance.theme.get()).toBe('light');

		// After the promise resolves, it hydrates from storage.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(instance.theme.get()).toBe('dark');
	});

	it('handles cross-tab sync via adapter.subscribe', async () => {
		const listeners = new Set<(data: string | null) => void>();
		const adapter: PersistenceAdapter = {
			read: () => null,
			write: () => {},
			remove: () => {},
			subscribe: (_key, fn) => {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		};

		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light' });

		// Simulate a storage event from another tab.
		for (const fn of listeners) {
			fn(JSON.stringify({ theme: 'dark' }));
		}

		expect(instance.theme.get()).toBe('dark');
	});

	it('cross-tab sync fires per-field subscribers', () => {
		const listeners = new Set<(data: string | null) => void>();
		const adapter: PersistenceAdapter = {
			read: () => null,
			write: () => {},
			remove: () => {},
			subscribe: (_key, fn) => {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		};

		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light' });

		const fieldSubscriber = vi.fn();
		instance.theme.subscribe(fieldSubscriber);

		// Simulate a storage event from another tab.
		for (const fn of listeners) {
			fn(JSON.stringify({ theme: 'dark' }));
		}

		expect(fieldSubscriber).toHaveBeenCalledWith('dark', 'light');
	});

	it('cross-tab sync fires whole-scope $subscribe listeners', () => {
		const listeners = new Set<(data: string | null) => void>();
		const adapter: PersistenceAdapter = {
			read: () => null,
			write: () => {},
			remove: () => {},
			subscribe: (_key, fn) => {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		};

		const prefs = valueScope({
			theme: value<string>(),
			fontSize: value<number>(),
		});
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light', fontSize: 12 });

		const scopeSubscriber = vi.fn();
		instance.$subscribe(scopeSubscriber);

		for (const fn of listeners) {
			fn(JSON.stringify({ theme: 'dark', fontSize: 16 }));
		}

		expect(scopeSubscriber).toHaveBeenCalled();
	});

	it('tears down cross-tab subscription on destroy', () => {
		const listeners = new Set<(data: string | null) => void>();
		const unsubscribe = vi.fn();
		const adapter: PersistenceAdapter = {
			read: () => null,
			write: () => {},
			remove: () => {},
			subscribe: (_key, fn) => {
				listeners.add(fn);
				return () => {
					listeners.delete(fn);
					unsubscribe();
				};
			},
		};

		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light' });
		instance.$destroy();

		expect(unsubscribe).toHaveBeenCalled();
		expect(listeners.size).toBe(0);
	});

	it('tolerates invalid stored JSON', () => {
		const adapter: PersistenceAdapter = {
			read: () => 'not valid json',
			write: () => {},
			remove: () => {},
		};
		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light' });

		expect(instance.theme.get()).toBe('light');
	});

	it.each([
		['array payload', '["dark"]'],
		['primitive string', '"dark"'],
		['primitive number', '42'],
		['null payload', 'null'],
	])('tolerates %s', (_label, raw) => {
		const adapter: PersistenceAdapter = {
			read: () => raw,
			write: () => {},
			remove: () => {},
		};
		const prefs = valueScope({ theme: value<string>() });
		const persisted = withPersistence(prefs, { key: 'prefs', adapter });
		const instance = persisted.create({ theme: 'light' });

		// Corrupt payload is rejected; the create-time input stands.
		expect(instance.theme.get()).toBe('light');
	});
});

describe('localStorageAdapter', () => {
	beforeEach(() => {
		// jsdom provides localStorage — clear it.
		globalThis.localStorage.clear();
	});

	afterEach(() => {
		globalThis.localStorage.clear();
	});

	it('reads and writes via localStorage', async () => {
		const { localStorageAdapter } =
			await import('../middleware/persistence/localStorageAdapter.js');
		localStorageAdapter.write('k', 'hello');
		expect(localStorageAdapter.read('k')).toBe('hello');
		localStorageAdapter.remove('k');
		expect(localStorageAdapter.read('k')).toBeNull();
	});

	it('returns null for missing keys', async () => {
		const { localStorageAdapter } =
			await import('../middleware/persistence/localStorageAdapter.js');
		expect(localStorageAdapter.read('missing')).toBeNull();
	});
});

describe('sessionStorageAdapter', () => {
	beforeEach(() => {
		globalThis.sessionStorage.clear();
	});

	afterEach(() => {
		globalThis.sessionStorage.clear();
	});

	it('reads and writes via sessionStorage', async () => {
		const { sessionStorageAdapter } =
			await import('../middleware/persistence/sessionStorageAdapter.js');
		sessionStorageAdapter.write('k', 'hello');
		expect(sessionStorageAdapter.read('k')).toBe('hello');
		sessionStorageAdapter.remove('k');
		expect(sessionStorageAdapter.read('k')).toBeNull();
	});

	it('has no subscribe method', async () => {
		const { sessionStorageAdapter } =
			await import('../middleware/persistence/sessionStorageAdapter.js');
		expect(sessionStorageAdapter.subscribe).toBeUndefined();
	});
});
