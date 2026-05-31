/**
 * Type-level tests for `.extendValues()` definition merging behavior.
 *
 * Pins:
 *  - `.extendValues({ext})` returns a template whose `Def` merges base + ext
 *  - Keys in the extension override base keys
 *  - `undefined` removes a key from the merged definition
 *  - A derivation in the extension layer is typed against the base prior
 */

import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import { valueScope } from '../../core/value-scope.js';
import type { FieldValue, FieldDerived } from '../../core/field-value.js';

// ── extendValues() returns properly typed template ──────────────────

const base = valueScope({
	name: value<string>(),
	age: value(0),
});

const extended = base.extendValues({
	role: value('viewer'),
});

const instance = extended.create({ name: 'Bob', role: 'admin' });

expectTypeOf(instance.name).toEqualTypeOf<
	FieldValue<string | undefined, string | undefined>
>();
expectTypeOf(instance.age).toEqualTypeOf<FieldValue<number, number>>();
expectTypeOf(instance.role).toEqualTypeOf<FieldValue<string, string>>();

// ── extendValues() with derivation against base prior ──────────────

const withDerived = base.extendValues({
	greeting: ({ scope }) => `Hello ${scope.name.use()}`,
});

const derivedInstance = withDerived.create({ name: 'Bob' });
expectTypeOf(derivedInstance.greeting).toEqualTypeOf<FieldDerived<string>>();

// ── extendValues() removes a base field via `undefined` ────────────

const stripped = base.extendValues({ age: undefined });
const strippedInstance = stripped.create({ name: 'Bob' });
expectTypeOf(strippedInstance.name).toEqualTypeOf<
	FieldValue<string | undefined, string | undefined>
>();
// @ts-expect-error — age removed from the merged definition
void strippedInstance.age;

// ── extendValues() override replaces base type ──────────────────────

const overridden = base.extendValues({
	age: value<string>('teen'),
});
const overriddenInstance = overridden.create();
expectTypeOf(overriddenInstance.age).toEqualTypeOf<
	FieldValue<string, string>
>();
