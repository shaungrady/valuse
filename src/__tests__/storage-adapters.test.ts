import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localStorageAdapter } from '../middleware/persistence/local-storage-adapter.js';
import { sessionStorageAdapter } from '../middleware/persistence/session-storage-adapter.js';
import { createWebStorageAdapter } from '../middleware/persistence/web-storage.js';

describe('localStorageAdapter', () => {
	let mockStorage: Map<string, string>;
	let originalLocalStorage: PropertyDescriptor | undefined;

	beforeEach(() => {
		mockStorage = new Map();
		originalLocalStorage = Object.getOwnPropertyDescriptor(
			globalThis,
			'localStorage',
		);
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: (key: string) => mockStorage.get(key) ?? null,
				setItem: (key: string, value: string) => {
					mockStorage.set(key, value);
				},
				removeItem: (key: string) => {
					mockStorage.delete(key);
				},
			},
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		if (originalLocalStorage) {
			Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
		} else {
			delete (globalThis as any).localStorage;
		}
	});

	it('read() returns stored value', () => {
		mockStorage.set('key1', 'value1');
		expect(localStorageAdapter.read('key1')).toBe('value1');
	});

	it('read() returns null for missing key', () => {
		expect(localStorageAdapter.read('missing')).toBeNull();
	});

	it('write() stores a value', () => {
		localStorageAdapter.write('key1', 'value1');
		expect(mockStorage.get('key1')).toBe('value1');
	});

	it('remove() deletes a value', () => {
		mockStorage.set('key1', 'value1');
		localStorageAdapter.remove('key1');
		expect(mockStorage.get('key1')).toBeUndefined();
	});

	it('subscribe() listens to storage events', () => {
		const fn = vi.fn();
		const unsub = localStorageAdapter.subscribe!('myKey', fn);

		// Simulate storage event
		const event = new StorageEvent('storage', {
			key: 'myKey',
			newValue: 'updated',
		});
		globalThis.dispatchEvent(event);

		expect(fn).toHaveBeenCalledWith('updated');
		unsub();
	});

	it('subscribe() ignores events for other keys', () => {
		const fn = vi.fn();
		const unsub = localStorageAdapter.subscribe!('myKey', fn);

		const event = new StorageEvent('storage', {
			key: 'otherKey',
			newValue: 'nope',
		});
		globalThis.dispatchEvent(event);

		expect(fn).not.toHaveBeenCalled();
		unsub();
	});

	it('subscribe() unsubscribe removes listener', () => {
		const fn = vi.fn();
		const unsub = localStorageAdapter.subscribe!('myKey', fn);
		unsub();

		const event = new StorageEvent('storage', {
			key: 'myKey',
			newValue: 'updated',
		});
		globalThis.dispatchEvent(event);

		expect(fn).not.toHaveBeenCalled();
	});
});

describe('sessionStorageAdapter', () => {
	let mockStorage: Map<string, string>;
	let originalSessionStorage: PropertyDescriptor | undefined;

	beforeEach(() => {
		mockStorage = new Map();
		originalSessionStorage = Object.getOwnPropertyDescriptor(
			globalThis,
			'sessionStorage',
		);
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: {
				getItem: (key: string) => mockStorage.get(key) ?? null,
				setItem: (key: string, value: string) => {
					mockStorage.set(key, value);
				},
				removeItem: (key: string) => {
					mockStorage.delete(key);
				},
			},
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		if (originalSessionStorage) {
			Object.defineProperty(
				globalThis,
				'sessionStorage',
				originalSessionStorage,
			);
		} else {
			delete (globalThis as any).sessionStorage;
		}
	});

	it('read() returns stored value', () => {
		mockStorage.set('key1', 'value1');
		expect(sessionStorageAdapter.read('key1')).toBe('value1');
	});

	it('read() returns null for missing key', () => {
		expect(sessionStorageAdapter.read('missing')).toBeNull();
	});

	it('write() stores a value', () => {
		sessionStorageAdapter.write('key1', 'value1');
		expect(mockStorage.get('key1')).toBe('value1');
	});

	it('remove() deletes a value', () => {
		mockStorage.set('key1', 'value1');
		sessionStorageAdapter.remove('key1');
		expect(mockStorage.get('key1')).toBeUndefined();
	});
});

// Best-effort contract: storage being unavailable or throwing on access must
// never surface as an error. read() -> null, write()/remove() -> no-op.
describe.each([
	['localStorage', localStorageAdapter] as const,
	['sessionStorage', sessionStorageAdapter] as const,
])('%s adapter — unavailable / hostile environments', (globalName, adapter) => {
	let original: PropertyDescriptor | undefined;

	beforeEach(() => {
		original = Object.getOwnPropertyDescriptor(globalThis, globalName);
	});

	afterEach(() => {
		if (original) Object.defineProperty(globalThis, globalName, original);
		else Reflect.deleteProperty(globalThis, globalName);
	});

	it('read() returns null and write()/remove() no-op when storage is absent (SSR)', () => {
		Reflect.deleteProperty(globalThis, globalName);
		expect(adapter.read('k')).toBeNull();
		expect(() => {
			adapter.write('k', 'v');
		}).not.toThrow();
		expect(() => {
			adapter.remove('k');
		}).not.toThrow();
	});

	it('does not throw when accessing storage throws (e.g. Safari private mode)', () => {
		Object.defineProperty(globalThis, globalName, {
			configurable: true,
			get() {
				throw new Error('SecurityError: access denied');
			},
		});
		expect(adapter.read('k')).toBeNull();
		expect(() => {
			adapter.write('k', 'v');
		}).not.toThrow();
		expect(() => {
			adapter.remove('k');
		}).not.toThrow();
	});
});

describe('createWebStorageAdapter — operation errors are swallowed', () => {
	const hostileStorage = {
		getItem: () => {
			throw new Error('read blocked');
		},
		setItem: () => {
			throw new Error('quota exceeded');
		},
		removeItem: () => {
			throw new Error('remove blocked');
		},
	} as unknown as Storage;

	it('read() returns null when getItem throws', () => {
		const adapter = createWebStorageAdapter({
			getStorage: () => hostileStorage,
		});
		expect(adapter.read('k')).toBeNull();
	});

	it('write() / remove() swallow thrown errors (quota, opaque origin)', () => {
		const adapter = createWebStorageAdapter({
			getStorage: () => hostileStorage,
		});
		expect(() => {
			adapter.write('k', 'v');
		}).not.toThrow();
		expect(() => {
			adapter.remove('k');
		}).not.toThrow();
	});

	it('is not subscribable unless opted in', () => {
		const adapter = createWebStorageAdapter({ getStorage: () => null });
		expect(adapter.subscribe).toBeUndefined();
	});

	it('subscribe() returns a no-op unsubscribe when addEventListener is unavailable', () => {
		const original = Object.getOwnPropertyDescriptor(
			globalThis,
			'addEventListener',
		);
		// Simulate a non-DOM global (SSR) where addEventListener isn't a function.
		Object.defineProperty(globalThis, 'addEventListener', {
			configurable: true,
			value: undefined,
		});
		try {
			const adapter = createWebStorageAdapter({
				getStorage: () => null,
				subscribable: true,
			});
			const unsub = adapter.subscribe!('k', vi.fn());
			expect(typeof unsub).toBe('function');
			expect(() => {
				unsub();
			}).not.toThrow();
		} finally {
			if (original)
				Object.defineProperty(globalThis, 'addEventListener', original);
		}
	});
});
