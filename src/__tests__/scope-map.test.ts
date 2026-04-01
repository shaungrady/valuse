import { describe, it, expect, vi } from 'vitest';
import { value, valueScope } from '../index.js';

const person = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
	role: value<string>('viewer'),
	fullName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
});

describe('scope.createMap()', () => {
	describe('creation', () => {
		it('creates an empty collection', () => {
			const people = person.createMap();
			expect(people.size).toBe(0);
		});

		it('creates from an array with key field name', () => {
			const data = [
				{ id: 'a', firstName: 'Alice', lastName: 'Smith' },
				{ id: 'b', firstName: 'Bob', lastName: 'Jones' },
			];
			const people = person.createMap(data, 'id');
			expect(people.size).toBe(2);
			expect(people.has('a')).toBe(true);
			expect(people.has('b')).toBe(true);
		});

		it('creates from an array with key callback', () => {
			const data = [
				{ id: 'a', firstName: 'Alice', lastName: 'Smith' },
				{ id: 'b', firstName: 'Bob', lastName: 'Jones' },
			];
			const people = person.createMap(data, (item) => item.id as string);
			expect(people.size).toBe(2);
		});

		it('creates from a Map of keyed inputs', () => {
			const data = new Map([
				['a', { firstName: 'Alice', lastName: 'Smith' }],
				['b', { firstName: 'Bob', lastName: 'Jones' }],
			]);
			const people = person.createMap(data);
			expect(people.size).toBe(2);
			expect(people.get('a')!.get('firstName')).toBe('Alice');
			expect(people.get('b')!.get('fullName')).toBe('Bob Jones');
		});
	});

	describe('set / get / delete', () => {
		it('sets and gets an entry', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice', lastName: 'Smith' });
			const inst = people.get('alice');
			expect(inst).toBeDefined();
			expect(inst!.get('firstName')).toBe('Alice');
			expect(inst!.get('fullName')).toBe('Alice Smith');
		});

		it('updates an existing entry', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice', lastName: 'Smith' });
			people.set('alice', { firstName: 'Alicia' });
			expect(people.get('alice')!.get('firstName')).toBe('Alicia');
		});

		it('deletes an entry', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice', lastName: 'Smith' });
			expect(people.delete('alice')).toBe(true);
			expect(people.has('alice')).toBe(false);
			expect(people.size).toBe(0);
		});

		it('delete returns false for missing key', () => {
			const people = person.createMap();
			expect(people.delete('nobody')).toBe(false);
		});
	});

	describe('Map-like methods', () => {
		it('.has()', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice' });
			expect(people.has('alice')).toBe(true);
			expect(people.has('bob')).toBe(false);
		});

		it('.keys()', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice' });
			people.set('bob', { firstName: 'Bob' });
			expect(people.keys()).toEqual(['alice', 'bob']);
		});

		it('.values()', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice' });
			expect(people.values()).toHaveLength(1);
			expect(people.values()[0]!.get('firstName')).toBe('Alice');
		});

		it('.entries()', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice' });
			const entries = people.entries();
			expect(entries).toHaveLength(1);
			expect(entries[0]![0]).toBe('alice');
			expect(entries[0]![1].get('firstName')).toBe('Alice');
		});

		it('.clear() removes all entries', () => {
			const people = person.createMap();
			people.set('alice', { firstName: 'Alice' });
			people.set('bob', { firstName: 'Bob' });
			people.clear();
			expect(people.size).toBe(0);
		});
	});

	describe('lifecycle', () => {
		it('fires onDestroy when deleting an entry', () => {
			const onDestroy = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onDestroy });
			const coll = scope.createMap();
			coll.set('a', { x: 1 });
			coll.delete('a');
			expect(onDestroy).toHaveBeenCalledOnce();
		});

		it('fires onDestroy for each entry on clear()', () => {
			const onDestroy = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onDestroy });
			const coll = scope.createMap();
			coll.set('a', { x: 1 });
			coll.set('b', { x: 2 });
			coll.clear();
			expect(onDestroy).toHaveBeenCalledTimes(2);
		});

		it('fires onInit when adding an entry', () => {
			const onInit = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onInit });
			const coll = scope.createMap();
			coll.set('a', { x: 1 });
			expect(onInit).toHaveBeenCalledOnce();
		});
	});

	describe('.subscribe()', () => {
		it('notifies when collection changes (add/delete)', () => {
			const people = person.createMap();
			const calls: (string | number)[][] = [];
			people.subscribe((keys) => calls.push(keys));
			people.set('alice', { firstName: 'Alice' });
			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual(['alice']);
		});

		it('returns unsubscribe', () => {
			const people = person.createMap();
			const calls: (string | number)[][] = [];
			const unsub = people.subscribe((keys) => calls.push(keys));
			unsub();
			people.set('alice', { firstName: 'Alice' });
			expect(calls).toHaveLength(0);
		});
	});
});
