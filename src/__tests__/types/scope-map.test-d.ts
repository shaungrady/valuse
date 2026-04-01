import { expectTypeOf } from 'expect-type';
import { value, valueScope } from '../../index.js';
import type { ScopeInstance } from '../../core/value-scope.js';

const person = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
	role: value<string>('viewer'),
	fullName: ({ use }) =>
		`${use('firstName') as string} ${use('lastName') as string}`,
});

const people = person.createMap();

// --- .get() returns ScopeInstance | undefined ---

const bob = people.get('bob');
expectTypeOf(bob).toEqualTypeOf<
	ScopeInstance<(typeof person)['definition']> | undefined
>();

// --- .set() returns ScopeInstance ---

const inst = people.set('bob', { firstName: 'Bob', lastName: 'Jones' });
expectTypeOf(inst).toEqualTypeOf<
	ScopeInstance<(typeof person)['definition']>
>();

// --- .use(key) returns [get, set] ---

const [get, scopeSet] = people.use('bob');
expectTypeOf(get('firstName')).toEqualTypeOf<string | undefined>();
expectTypeOf(get('role')).toEqualTypeOf<string>();
expectTypeOf(get('fullName')).toEqualTypeOf<string>();
scopeSet('firstName', 'Robert');

// --- .use(key, field) returns [value, setter] for value keys ---

const [firstName, setFirstName] = people.use('bob', 'firstName');
expectTypeOf(firstName).toEqualTypeOf<string | undefined>();
expectTypeOf(setFirstName).toBeFunction();

const [role, setRole] = people.use('bob', 'role');
expectTypeOf(role).toEqualTypeOf<string>();
expectTypeOf(setRole).toBeFunction();

// --- .use(key, field) returns [value] for derivations ---

const [fullName] = people.use('bob', 'fullName');
expectTypeOf(fullName).toEqualTypeOf<string>();

// --- .keys() returns (string | number)[] ---

expectTypeOf(people.keys()).toEqualTypeOf<(string | number)[]>();

// --- .useKeys() returns (string | number)[] ---

expectTypeOf(people.useKeys()).toEqualTypeOf<(string | number)[]>();

// --- narrowed key type ---

const numbered = person.createMap<number>();
expectTypeOf(numbered.keys()).toEqualTypeOf<number[]>();
expectTypeOf(numbered.useKeys()).toEqualTypeOf<number[]>();
