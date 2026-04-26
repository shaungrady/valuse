import { expectTypeOf } from 'expect-type';
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
	valueSchema,
	type ValueSchema,
	type ValidationState,
} from '../../core/value-schema.js';

// ── Type inference from schemas ────────────────────────────────────────

// Pure validator (In = Out)
const Email = type('string.email');
void Email; // suppress unused

type EmailField = ValueSchema<string, string>;

// .get() returns In (string)
expectTypeOf<EmailField['get']>().returns.toEqualTypeOf<string>();

// .set() accepts In or updater function
expectTypeOf<EmailField['set']>()
	.parameter(0)
	.toEqualTypeOf<string | ((prev: string) => string)>();

// ── Parsing morph (In ≠ Out) ───────────────────────────────────────────

const Count = type('string.numeric.parse');
void Count; // suppress unused

type CountField = ValueSchema<string, number>;

// .get() returns In (string), not Out (number)
expectTypeOf<CountField['get']>().returns.toEqualTypeOf<string>();

// .set() accepts In (string) or updater
expectTypeOf<CountField['set']>()
	.parameter(0)
	.toEqualTypeOf<string | ((prev: string) => string)>();

// ── ValidationState discriminated union ────────────────────────────────

type EmailValidation = ValidationState<string, string>;

// The union should be discriminated on isValid
declare const emailValidation: EmailValidation;
if (emailValidation.isValid) {
	expectTypeOf(emailValidation.value).toEqualTypeOf<string>();
	expectTypeOf(emailValidation.issues).toEqualTypeOf<readonly []>();
} else {
	expectTypeOf(emailValidation.value).toEqualTypeOf<string>();
	expectTypeOf(emailValidation.issues).toEqualTypeOf<
		readonly StandardSchemaV1.Issue[]
	>();
}

// Parsing morph: valid state has Out, invalid has In
type CountValidation = ValidationState<string, number>;
declare const countValidation: CountValidation;
if (countValidation.isValid) {
	expectTypeOf(countValidation.value).toEqualTypeOf<number>();
} else {
	expectTypeOf(countValidation.value).toEqualTypeOf<string>();
}

// ── Literal union schemas ──────────────────────────────────────────────

const View = type("'list' | 'grid'");
void View; // suppress unused

type ViewField = ValueSchema<'list' | 'grid', 'list' | 'grid'>;

// .get() and .set() use the literal union, not widened to string
expectTypeOf<ViewField['get']>().returns.toEqualTypeOf<'list' | 'grid'>();

// ── .getValidation() return type ──────────────────────────────────────

expectTypeOf<EmailField['getValidation']>().returns.toEqualTypeOf<
	ValidationState<string, string>
>();

// ── Sync-only schema constraint ────────────────────────────────────────

// SyncStandardSchema is a pass-through since the Standard Schema spec
// always includes Promise in the validate return union. Async schemas
// are caught at runtime instead of compile time.

import type { SyncStandardSchema } from '../../core/value-schema.js';

// Any StandardSchemaV1 passes through
type SyncCheck = SyncStandardSchema<typeof Email>;
expectTypeOf<SyncCheck>().not.toBeNever();

// ── valueSchema factory infers types from schema ──────────────────────

const emailInstance = valueSchema(Email, '');
expectTypeOf(emailInstance.get()).toBeString();
expectTypeOf(emailInstance.getValidation()).toEqualTypeOf<
	ValidationState<string, string>
>();
