import { expectTypeOf } from 'expect-type';
import { value, Value } from '../../core/value.js';
import { valueScope } from '../../core/value-scope.js';
import type { FieldValue, FieldDerived } from '../../core/field-value.js';
import type { ExtendDef } from '../../core/scope-types.js';

// ── ExtendDef merges types ──────────────────────────────────────────

type Base = { name: Value<string>; age: Value<number> };
type Ext = { role: Value<string> };
type Merged = ExtendDef<Base, Ext>;

expectTypeOf<Merged>().toMatchTypeOf<{
	name: Value<string>;
	age: Value<number>;
	role: Value<string>;
}>();

// ── ExtendDef removes keys via undefined ────────────────────────────

type WithRemoval = ExtendDef<Base, { age: undefined }>;
// age should be removed
// @ts-expect-error — age is removed from the definition
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _CheckAgeRemoved = WithRemoval['age'];

// name should remain
expectTypeOf<WithRemoval['name']>().toEqualTypeOf<Value<string>>();

// ── ExtendDef overrides keys ────────────────────────────────────────

type WithOverride = ExtendDef<Base, { age: Value<string> }>;
expectTypeOf<WithOverride['age']>().toEqualTypeOf<Value<string>>();

// ── extend() returns properly typed template ────────────────────────

const base = valueScope({
	name: value<string>(),
	age: value(0),
});

const extended = base.extend({
	role: value('viewer'),
});

const instance = extended.create({ name: 'Bob', role: 'admin' });

expectTypeOf(instance.name).toEqualTypeOf<
	FieldValue<string | undefined, string | undefined>
>();
expectTypeOf(instance.age).toEqualTypeOf<FieldValue<number, number>>();
expectTypeOf(instance.role).toEqualTypeOf<FieldValue<string, string>>();

// ── extend() with derivation ────────────────────────────────────────

const withDerived = base.extend({
	greeting: ({ scope }: { scope: any }) => `Hello ${scope.name.use()}`,
});

const derivedInstance = withDerived.create({ name: 'Bob' });
expectTypeOf(derivedInstance.greeting).toEqualTypeOf<FieldDerived<string>>();
