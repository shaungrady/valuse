import { expectTypeOf } from 'expect-type';
import {
	value,
	valueRef,
	valueSet,
	valueMap,
	valueScope,
} from '../../index.js';

// --- valueRef() infers T from the source ---

const strRef = valueRef(value('hello'));
expectTypeOf(strRef.get()).toEqualTypeOf<string>();

const setRef = valueRef(valueSet<string>(['a']));
expectTypeOf(setRef.get()).toEqualTypeOf<Set<string>>();

const mapRef = valueRef(valueMap<string, number>());
expectTypeOf(mapRef.get()).toEqualTypeOf<Map<string, number>>();

// --- Refs are read-only in scopes (not in ValueKeys) ---

const scope = valueScope({
	name: value<string>(),
	tags: valueRef(valueSet<string>()),
	doubled: ({ use }) => use('name'),
});

const inst = scope.create();

// get() works on all keys
expectTypeOf(inst.get('name')).toEqualTypeOf<string | undefined>();
expectTypeOf(inst.get('tags')).toEqualTypeOf<Set<string>>();

// set() only works on value keys — not refs or derivations
expectTypeOf(inst.set<'name'>).toBeCallableWith('name', 'Alice');

// @ts-expect-error - cannot set a ref key
inst.set('tags', new Set(['x']));

// @ts-expect-error - cannot set a derivation key
inst.set('doubled', 'foo');

// --- CreateInput excludes ref keys ---

// create() only accepts value keys
scope.create({ name: 'Alice' });

// @ts-expect-error - cannot provide ref key in create input
scope.create({ tags: new Set(['x']) });

// --- Ref with value that has no default ---

const optRef = valueRef(value<string>());
expectTypeOf(optRef.get()).toEqualTypeOf<string | undefined>();

// --- use() get/set tuple: get reads refs, set excludes refs ---

const [get, set] = inst.use();
expectTypeOf(get('tags')).toEqualTypeOf<Set<string>>();
expectTypeOf(set<'name'>).toBeCallableWith('name', 'Bob');

// --- ScopeInstance refs: chained .get()/.set() with full type flow ---

const addressScope = valueScope({
	street: value<string>(),
	city: value('NYC'),
	full: ({ use }) => `${use('street')}, ${use('city')}`,
});
const addressInst = addressScope.create({ street: '123 Main' });

// valueRef(scopeInstance) → ValueRef<ScopeInstance<Def>>
const addrRef = valueRef(addressInst);
const addrFromRef = addrRef.get();

// Chained get is typed
expectTypeOf(addrFromRef.get('street')).toEqualTypeOf<string | undefined>();
expectTypeOf(addrFromRef.get('city')).toEqualTypeOf<string>();
expectTypeOf(addrFromRef.get('full')).toEqualTypeOf<string>();

// Chained set is typed (only value keys)
expectTypeOf(addrFromRef.set<'street'>).toBeCallableWith('street', '456 Oak');

// @ts-expect-error - cannot set a derivation on the referenced scope
addrFromRef.set('full', 'nope');

// In a parent scope: get("address") returns the typed ScopeInstance
const personScope = valueScope({
	name: value<string>(),
	address: valueRef(addressInst),
});
const personInst = personScope.create({ name: 'Alice' });

// get("address") returns the full ScopeInstance type
const addr = personInst.get('address');
expectTypeOf(addr.get('street')).toEqualTypeOf<string | undefined>();
expectTypeOf(addr.get('city')).toEqualTypeOf<string>();

// set("address", ...) is a type error — refs are read-only
// @ts-expect-error - cannot set a ref key
personInst.set('address', addressInst);
