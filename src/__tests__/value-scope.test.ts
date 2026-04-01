import { describe, it, expect } from 'vitest';
import { value, valueScope } from '../index.js';

const person = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
	role: value<string>('viewer'),
	fullName: ({ use }) =>
		`${use('firstName') as string} ${use('lastName') as string}`,
});

describe('valueScope', () => {
	describe('.create()', () => {
		it('creates an instance with provided values', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			expect(bob.get('firstName')).toBe('Bob');
			expect(bob.get('lastName')).toBe('Jones');
		});

		it('uses defaults for omitted values', () => {
			const bob = person.create({ firstName: 'Bob' });
			expect(bob.get('role')).toBe('viewer');
		});

		it('creates with no args — values are undefined or defaults', () => {
			const empty = person.create();
			expect(empty.get('firstName')).toBeUndefined();
			expect(empty.get('role')).toBe('viewer');
		});
	});

	describe('get()', () => {
		it('returns value for value keys', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			expect(bob.get('firstName')).toBe('Bob');
		});

		it('returns computed value for derivation keys', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			expect(bob.get('fullName')).toBe('Bob Jones');
		});

		it('derivation updates when dependency changes', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.set('firstName', 'Robert');
			expect(bob.get('fullName')).toBe('Robert Jones');
		});
	});

	describe('set()', () => {
		it('sets a value field', () => {
			const bob = person.create({ firstName: 'Bob' });
			bob.set('firstName', 'Robert');
			expect(bob.get('firstName')).toBe('Robert');
		});

		it('sets via callback', () => {
			const inst = valueScope({
				count: value<number>(0),
			}).create();
			inst.set('count', (prev) => prev + 1);
			expect(inst.get('count')).toBe(1);
		});

		it('ignores set on derivation keys at runtime', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			// At runtime, setting a derivation is silently ignored
			(bob as any).set('fullName', 'anything');
			expect(bob.get('fullName')).toBe('Bob Jones');
		});

		it('bulk sets multiple fields at once', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.set({ firstName: 'Robert', lastName: 'Smith' });
			expect(bob.get('firstName')).toBe('Robert');
			expect(bob.get('lastName')).toBe('Smith');
		});

		it('bulk set only updates provided fields', () => {
			const bob = person.create({
				firstName: 'Bob',
				lastName: 'Jones',
				role: 'admin',
			});
			bob.set({ firstName: 'Robert' });
			expect(bob.get('firstName')).toBe('Robert');
			expect(bob.get('lastName')).toBe('Jones');
			expect(bob.get('role')).toBe('admin');
		});

		it('bulk set silently ignores derivation/unknown keys', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			(bob as any).set({
				fullName: 'nope',
				unknown: 'ignored',
				firstName: 'Robert',
			});
			expect(bob.get('firstName')).toBe('Robert');
			expect(bob.get('fullName')).toBe('Robert Jones');
		});

		it('bulk set triggers onChange with all changes batched', async () => {
			const changes: any[] = [];
			const scope = valueScope(
				{
					x: value(0),
					y: value(0),
				},
				{
					onChange: ({ changes: c }) => {
						changes.push(...c);
					},
				},
			);
			const inst = scope.create();
			inst.set({ x: 10, y: 20 });
			await Promise.resolve();
			expect(changes).toHaveLength(2);
			expect(changes.map((c: any) => c.key)).toEqual(['x', 'y']);
		});
	});

	describe('.subscribe()', () => {
		it('notifies when a value changes', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			const calls: string[] = [];
			bob.subscribe((get) => {
				calls.push(get('firstName') as string);
			});
			bob.set('firstName', 'Robert');
			expect(calls).toContain('Robert');
		});

		it('returns unsubscribe function', () => {
			const bob = person.create({ firstName: 'Bob' });
			const calls: string[] = [];
			const unsub = bob.subscribe((get) => {
				calls.push(get('firstName') as string);
			});
			unsub();
			bob.set('firstName', 'Robert');
			expect(calls).not.toContain('Robert');
		});
	});

	describe('.destroy()', () => {
		it('detaches subscribers', () => {
			const bob = person.create({ firstName: 'Bob' });
			const calls: string[] = [];
			bob.subscribe((get) => {
				calls.push(get('firstName') as string);
			});
			bob.destroy();
			bob.set('firstName', 'Robert');
			expect(calls).not.toContain('Robert');
		});
	});

	describe('scope with only values', () => {
		it('works without derivations', () => {
			const point = valueScope({
				x: value<number>(0),
				y: value<number>(0),
			});
			const p = point.create({ x: 10, y: 20 });
			expect(p.get('x')).toBe(10);
			expect(p.get('y')).toBe(20);
			p.set('x', 42);
			expect(p.get('x')).toBe(42);
		});
	});

	describe('getSnapshot()', () => {
		it('returns values, derivations, and refs', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			const snap = bob.getSnapshot();
			expect(snap).toEqual({
				firstName: 'Bob',
				lastName: 'Jones',
				role: 'viewer',
				fullName: 'Bob Jones',
			});
		});

		it('reflects current state after mutations', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.set('role', 'admin');
			const snap = bob.getSnapshot();
			expect(snap.role).toBe('admin');
			expect(snap.fullName).toBe('Bob Jones');
		});
	});

	describe('setSnapshot()', () => {
		it('replaces all values, omitted keys reset to undefined', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.setSnapshot({ firstName: 'Alice' });
			expect(bob.get('firstName')).toBe('Alice');
			expect(bob.get('lastName')).toBeUndefined();
			expect(bob.get('role')).toBeUndefined();
		});

		it('derivations recompute after setSnapshot', () => {
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.setSnapshot({ firstName: 'Alice', lastName: 'Smith' });
			expect(bob.get('fullName')).toBe('Alice Smith');
		});

		it('with rerunInit re-fires onInit', () => {
			let initCount = 0;
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					onInit: () => {
						initCount++;
					},
				},
			);
			const inst = scope.create({ x: 5 });
			expect(initCount).toBe(1);
			inst.setSnapshot({ x: 10 }, { rerunInit: true });
			expect(initCount).toBe(2);
			expect(inst.get('x')).toBe(10);
		});

		it('without rerunInit does not fire onInit', () => {
			let initCount = 0;
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					onInit: () => {
						initCount++;
					},
				},
			);
			const inst = scope.create({ x: 5 });
			expect(initCount).toBe(1);
			inst.setSnapshot({ x: 10 });
			expect(initCount).toBe(1);
		});
	});
});
