import { expectTypeOf } from 'expect-type';
import { value, valueScope } from '../../index.js';
import type { Unsubscribe } from '../../index.js';

// --- Define a scope with values and derivations ---

const person = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
	role: value<string>('viewer'),
	fullName: ({ use }) =>
		`${use('firstName') as string} ${use('lastName') as string}`,
});

// --- .create() returns a scope instance ---

const bob = person.create({
	firstName: 'Bob',
	lastName: 'Jones',
});

// --- get() returns the correct type for each key ---

// Value with no default: string | undefined
expectTypeOf(bob.get('firstName')).toEqualTypeOf<string | undefined>();
expectTypeOf(bob.get('lastName')).toEqualTypeOf<string | undefined>();

// Value with default: string
expectTypeOf(bob.get('role')).toEqualTypeOf<string>();

// Derivation: string
expectTypeOf(bob.get('fullName')).toEqualTypeOf<string>();

// --- set() works on value keys ---

bob.set('firstName', 'Robert');
bob.set('role', 'admin');

// set with callback
bob.set('role', (_prev: string) => 'admin');

// --- set() is a type error on derivation keys ---

// @ts-expect-error - cannot set a derivation
bob.set('fullName', 'anything');

// --- .create() with no args ---

const empty = person.create();
expectTypeOf(empty.get('firstName')).toEqualTypeOf<string | undefined>();
expectTypeOf(empty.get('role')).toEqualTypeOf<string>();

// --- .create() accepts partial input (only value keys, all optional) ---

const partial = person.create({ role: 'admin' });
expectTypeOf(partial.get('role')).toEqualTypeOf<string>();

// --- .create() rejects derivation keys in input ---

// @ts-expect-error - cannot pass derivation key to create
person.create({ fullName: 'anything' });

// --- .subscribe() returns unsubscribe ---

const unsub = bob.subscribe((_get) => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();

// --- .destroy() exists ---

expectTypeOf(bob.destroy).toBeFunction();

// --- Simple scope with only values (no derivations) ---

const simple = valueScope({
	x: value<number>(0),
	y: value<number>(0),
});

const inst = simple.create({ x: 10, y: 20 });
expectTypeOf(inst.get('x')).toEqualTypeOf<number>();
inst.set('x', 42);

// --- Bulk set() accepts CreateInput ---

bob.set({ firstName: 'Robert', role: 'admin' });
bob.set({ role: 'editor' });
bob.set({}); // empty is fine — all keys optional

// @ts-expect-error - cannot bulk-set a derivation key
bob.set({ fullName: 'anything' });

// --- use() setter supports both forms ---

const [, set] = bob.use();
set('firstName', 'Robert');
set({ firstName: 'Robert', role: 'admin' });

// --- use(key) returns [value, setter] for value keys ---

const [firstName, setFirstName] = bob.use('firstName');
expectTypeOf(firstName).toEqualTypeOf<string | undefined>();
expectTypeOf(setFirstName).toBeFunction();

const [role, setRole] = bob.use('role');
expectTypeOf(role).toEqualTypeOf<string>();
expectTypeOf(setRole).toBeFunction();

// --- use(key) returns [value] for derivations ---

const [fullName] = bob.use('fullName');
expectTypeOf(fullName).toEqualTypeOf<string>();
