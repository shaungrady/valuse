import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localStorageAdapter } from '../middleware/persistence/localStorageAdapter.js';
import { sessionStorageAdapter } from '../middleware/persistence/sessionStorageAdapter.js';

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
