import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';

describe('ScopeMap', () => {
	const person = valueScope({
		firstName: value<string>(),
		lastName: value<string>(),
	});

	describe('createMap()', () => {
		it('creates an empty map', () => {
			const map = person.createMap();
			expect(map.size).toBe(0);
		});

		it('creates a map from entries', () => {
			const map = person.createMap([
				['alice', { firstName: 'Alice', lastName: 'Smith' }],
				['bob', { firstName: 'Bob', lastName: 'Jones' }],
			]);
			expect(map.size).toBe(2);
			expect(map.get('alice')!.firstName.get()).toBe('Alice');
			expect(map.get('bob')!.lastName.get()).toBe('Jones');
		});

		it('creates a map from a Map', () => {
			const data = new Map<string, Record<string, unknown>>([
				['alice', { firstName: 'Alice', lastName: 'Smith' }],
			]);
			const map = person.createMap(data);
			expect(map.get('alice')!.firstName.get()).toBe('Alice');
		});
	});

	it('creates a map from an array keyed by field name', () => {
		const withId = valueScope({
			id: value<string>(),
			name: value<string>(),
		});
		const map = withId.createMap(
			[
				{ id: 'a', name: 'Alice' },
				{ id: 'b', name: 'Bob' },
			],
			'id',
		);
		expect(map.size).toBe(2);
		expect(map.get('a')!.name.get()).toBe('Alice');
		expect(map.get('b')!.name.get()).toBe('Bob');
	});

	it('creates a map from an array keyed by callback', () => {
		const withId = valueScope({
			id: value<number>(),
			name: value<string>(),
		});
		const map = withId.createMap(
			[
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Bob' },
			],
			(item) => item.id!,
		);
		expect(map.size).toBe(2);
		expect(map.get(1)!.name.get()).toBe('Alice');
		expect(map.get(2)!.name.get()).toBe('Bob');
	});

	describe('set/get/has/delete', () => {
		it('set creates a new instance', () => {
			const map = person.createMap();
			const instance = map.set('alice', {
				firstName: 'Alice',
				lastName: 'Smith',
			});
			expect(map.has('alice')).toBe(true);
			expect(instance.firstName.get()).toBe('Alice');
		});

		it('set updates existing instance via $setSnapshot', () => {
			const map = person.createMap([
				['alice', { firstName: 'Alice', lastName: 'Smith' }],
			]);
			map.set('alice', { firstName: 'Alicia' });
			expect(map.get('alice')!.firstName.get()).toBe('Alicia');
			expect(map.get('alice')!.lastName.get()).toBe('Smith');
		});

		it('get returns undefined for missing key', () => {
			const map = person.createMap();
			expect(map.get('missing')).toBeUndefined();
		});

		it('delete removes and destroys instance', () => {
			const map = person.createMap([['alice', { firstName: 'Alice' }]]);
			const deleted = map.delete('alice');
			expect(deleted).toBe(true);
			expect(map.has('alice')).toBe(false);
			expect(map.size).toBe(0);
		});

		it('delete returns false for missing key', () => {
			const map = person.createMap();
			expect(map.delete('missing')).toBe(false);
		});
	});

	describe('keys/values/entries', () => {
		it('returns keys', () => {
			const map = person.createMap([
				['alice', { firstName: 'Alice' }],
				['bob', { firstName: 'Bob' }],
			]);
			expect(map.keys()).toEqual(['alice', 'bob']);
		});

		it('returns values', () => {
			const map = person.createMap([['alice', { firstName: 'Alice' }]]);
			expect(map.values()).toHaveLength(1);
		});

		it('returns entries', () => {
			const map = person.createMap([['alice', { firstName: 'Alice' }]]);
			const entries = map.entries();
			expect(entries).toHaveLength(1);
			expect(entries[0]![0]).toBe('alice');
		});
	});

	describe('clear', () => {
		it('removes all instances', () => {
			const map = person.createMap([
				['alice', { firstName: 'Alice' }],
				['bob', { firstName: 'Bob' }],
			]);
			map.clear();
			expect(map.size).toBe(0);
		});
	});

	describe('subscribe', () => {
		it('notifies on add', () => {
			const map = person.createMap();
			const subscriber = vi.fn();
			map.subscribe(subscriber);
			map.set('alice', { firstName: 'Alice' });
			expect(subscriber).toHaveBeenCalledWith(['alice']);
		});

		it('notifies on delete', () => {
			const map = person.createMap([
				['alice', { firstName: 'Alice' }],
				['bob', { firstName: 'Bob' }],
			]);
			const subscriber = vi.fn();
			map.subscribe(subscriber);
			map.delete('alice');
			expect(subscriber).toHaveBeenCalledWith(['bob']);
		});

		it('unsubscribe stops notifications', () => {
			const map = person.createMap();
			const subscriber = vi.fn();
			const unsub = map.subscribe(subscriber);
			unsub();
			map.set('alice', { firstName: 'Alice' });
			expect(subscriber).not.toHaveBeenCalled();
		});
	});
});
