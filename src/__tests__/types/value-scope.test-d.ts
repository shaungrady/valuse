import { expectTypeOf } from 'expect-type';
import { value, Value } from '../../core/value.js';
import { valueScope, ScopeTemplate } from '../../core/value-scope.js';
import type { ScopeConfig } from '../../core/value-scope.js';
import type {
	FieldValue,
	FieldDerived,
	FieldAsyncDerived,
} from '../../core/field-value.js';
import type {
	ScopeInstance,
	ValueInputOf,
	SnapshotOf,
	MapDefinition,
	GenericScopeInstance,
} from '../../core/scope-types.js';
import type { Unsubscribe, ScopeNode, Change } from '../../core/types.js';

// ── valueScope returns ScopeTemplate<Def> ───────────────────────────

const personDef = {
	firstName: value<string>(),
	lastName: value<string>(),
	role: value('viewer'),
};

const person = valueScope(personDef);

expectTypeOf(person).toMatchTypeOf<ScopeTemplate<typeof personDef>>();

// ── create() returns ScopeInstance<Def> ─────────────────────────────

const bob = person.create({
	firstName: 'Bob',
	lastName: 'Jones',
});

// Value with no default: FieldValue<string | undefined, string | undefined>
expectTypeOf(bob.firstName).toEqualTypeOf<
	FieldValue<string | undefined, string | undefined>
>();
expectTypeOf(bob.firstName.get()).toEqualTypeOf<string | undefined>();

// Value with default: FieldValue<string, string>
expectTypeOf(bob.role).toEqualTypeOf<FieldValue<string, string>>();
expectTypeOf(bob.role.get()).toEqualTypeOf<string>();

// ── create() accepts partial input (all optional) ───────────────────

const empty = person.create();
expectTypeOf(empty.firstName.get()).toEqualTypeOf<string | undefined>();
expectTypeOf(empty.role.get()).toEqualTypeOf<string>();

const partial = person.create({ role: 'admin' });
expectTypeOf(partial.role.get()).toEqualTypeOf<string>();

// ── Derivations become FieldDerived ─────────────────────────────────

const withDerived = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
	fullName: ({ scope }: { scope: any }) =>
		`${scope.firstName.use()} ${scope.lastName.use()}`,
});

const derived = withDerived.create({ firstName: 'Bob', lastName: 'Jones' });
expectTypeOf(derived.fullName).toEqualTypeOf<FieldDerived<string>>();
expectTypeOf(derived.fullName.get()).toEqualTypeOf<string>();

// FieldDerived has no .set()
// @ts-expect-error — derived values cannot be set
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
derived.fullName.set;

// ── Async derivations become FieldAsyncDerived ──────────────────────

const withAsync = valueScope({
	userId: value<string>(),
	profile: async ({ scope }: { scope: any }) => {
		return { name: scope.userId.use() as string };
	},
});

const asyncInstance = withAsync.create({ userId: 'alice' });
expectTypeOf(asyncInstance.profile).toEqualTypeOf<
	FieldAsyncDerived<{ name: string }>
>();
expectTypeOf(asyncInstance.profile.get()).toEqualTypeOf<
	{ name: string } | undefined
>();

// ── $ methods ───────────────────────────────────────────────────────

expectTypeOf(bob.$destroy).toEqualTypeOf<() => void>();
expectTypeOf(bob.$subscribe(() => {})).toEqualTypeOf<Unsubscribe>();
expectTypeOf(bob.$recompute).toEqualTypeOf<() => void>();

// $getSnapshot returns SnapshotOf<Def>
const snapshot = bob.$getSnapshot();
expectTypeOf(snapshot.firstName).toEqualTypeOf<string | undefined>();
expectTypeOf(snapshot.role).toEqualTypeOf<string>();

// $get returns same as $getSnapshot
const got = bob.$get();
expectTypeOf(got.firstName).toEqualTypeOf<string | undefined>();
expectTypeOf(got.role).toEqualTypeOf<string>();

// $use returns [SnapshotOf<Def>, setter]
const [used, setUsed] = bob.$use();
expectTypeOf(used.firstName).toEqualTypeOf<string | undefined>();
expectTypeOf(used.role).toEqualTypeOf<string>();
expectTypeOf(setUsed).toBeFunction();

// ── ValueInputOf ────────────────────────────────────────────────────

type PersonDef = typeof personDef;
type PersonInput = ValueInputOf<PersonDef>;

// All value keys are optional
expectTypeOf<PersonInput>().toMatchTypeOf<{
	firstName?: string | undefined;
	lastName?: string | undefined;
	role?: string;
}>();

// Derivation keys are excluded from input
type WithDerivedDef = {
	name: Value<string>;
	greeting: (ctx: { scope: any }) => string;
};
type DerivedInput = ValueInputOf<WithDerivedDef>;
// Only value keys appear in input, derivations excluded
expectTypeOf<DerivedInput>().toHaveProperty('name');
// @ts-expect-error — derivation key excluded from input
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _CheckGreetingExcluded = DerivedInput['greeting'];

// ── SnapshotOf ──────────────────────────────────────────────────────

type PersonSnapshot = SnapshotOf<PersonDef>;
expectTypeOf<PersonSnapshot>().toMatchTypeOf<{
	firstName: string | undefined;
	lastName: string | undefined;
	role: string;
}>();

// ── Nested groups become Readonly<MapDefinition<Group>> ─────────────

const nested = valueScope({
	address: {
		street: value<string>(),
		city: value('Unknown'),
	},
});

const nestedInstance = nested.create({
	address: { street: '123 Main' },
});

expectTypeOf(nestedInstance.address.street.get()).toEqualTypeOf<
	string | undefined
>();
expectTypeOf(nestedInstance.address.city.get()).toEqualTypeOf<string>();

// ── MapDefinition ───────────────────────────────────────────────────

type SimpleDef = { name: Value<string, string>; count: Value<number, number> };
type Mapped = MapDefinition<SimpleDef>;
expectTypeOf<Mapped>().toMatchTypeOf<{
	readonly name: FieldValue<string, string>;
	readonly count: FieldValue<number, number>;
}>();

// ── ScopeInstance includes $ methods ────────────────────────────────

type Instance = ScopeInstance<SimpleDef>;
expectTypeOf<Instance>().toMatchTypeOf<{
	readonly name: FieldValue<string, string>;
	readonly count: FieldValue<number, number>;
	$destroy: () => void;
	$subscribe: (fn: () => void) => Unsubscribe;
	$recompute: () => void;
}>();

// ── ScopeConfig hook context shapes ────────────────────────────────

// onCreate receives { scope, input, signal, onCleanup }
expectTypeOf<NonNullable<ScopeConfig['onCreate']>>().toBeCallableWith({
	scope: {} as GenericScopeInstance,
	input: undefined,
	signal: new AbortController().signal,
	onCleanup: (() => {}) as (fn: () => void) => void,
});

// onDestroy receives { scope }
expectTypeOf<NonNullable<ScopeConfig['onDestroy']>>().toBeCallableWith({
	scope: {} as GenericScopeInstance,
});

// onChange receives { scope, changes, changesByScope }
expectTypeOf<NonNullable<ScopeConfig['onChange']>>().toBeCallableWith({
	scope: {} as ScopeNode,
	changes: new Set<Change>(),
	changesByScope: new Map<ScopeNode, Change[]>(),
});

// beforeChange receives { scope, changes, changesByScope, prevent }
expectTypeOf<NonNullable<ScopeConfig['beforeChange']>>().toBeCallableWith({
	scope: {} as ScopeNode,
	changes: new Set<Change>(),
	changesByScope: new Map<ScopeNode, Change[]>(),
	prevent: (() => {}) as (target?: ScopeNode | Change) => void,
});

// onUsed receives { scope, signal, onCleanup }
expectTypeOf<NonNullable<ScopeConfig['onUsed']>>().toBeCallableWith({
	scope: {} as GenericScopeInstance,
	signal: new AbortController().signal,
	onCleanup: (() => {}) as (fn: () => void) => void,
});

// ── $getIsValid / $useIsValid / $getValidation / $useValidation ─────

import { valueSchema } from '../../core/value-schema.js';
import { type } from 'arktype';
import type { ScopeValidationResult } from '../../core/scope-types.js';
import type { StandardSchemaV1 as _StandardSchemaV1 } from '@standard-schema/spec';

const validationForm = valueScope({
	email: valueSchema(type('string.email'), ''),
}).create();

// $getIsValid / $useIsValid return boolean and accept the deep option.
expectTypeOf(validationForm.$getIsValid).toBeFunction();
expectTypeOf(validationForm.$getIsValid()).toEqualTypeOf<boolean>();
expectTypeOf(
	validationForm.$getIsValid({ deep: true }),
).toEqualTypeOf<boolean>();
expectTypeOf(validationForm.$useIsValid()).toEqualTypeOf<boolean>();
expectTypeOf(
	validationForm.$useIsValid({ deep: true }),
).toEqualTypeOf<boolean>();

// $getValidation / $useValidation return ScopeValidationResult with
// readonly isValid + readonly issues array of StandardSchemaV1.Issue.
expectTypeOf(
	validationForm.$getValidation(),
).toEqualTypeOf<ScopeValidationResult>();
expectTypeOf(
	validationForm.$getValidation({ deep: true }),
).toEqualTypeOf<ScopeValidationResult>();
expectTypeOf(
	validationForm.$useValidation(),
).toEqualTypeOf<ScopeValidationResult>();
expectTypeOf(
	validationForm.$useValidation({ deep: true }),
).toEqualTypeOf<ScopeValidationResult>();

// The result's issues array is read-only and holds StandardSchemaV1.Issue.
const validationResult = validationForm.$getValidation();
expectTypeOf(validationResult.isValid).toEqualTypeOf<boolean>();
expectTypeOf(validationResult.issues).toEqualTypeOf<
	ReadonlyArray<_StandardSchemaV1.Issue>
>();

// onUnused receives { scope }
expectTypeOf<NonNullable<ScopeConfig['onUnused']>>().toBeCallableWith({
	scope: {} as GenericScopeInstance,
});
