/**
 * Type-level tests for the new `.extendValues()` and `.extendConfig()`
 * methods on ScopeTemplate. Mirrors the structure of variadic-extend.test-d.ts
 * but exercises the new split API.
 */

import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import {
	valueScope,
	asUnknownValueScope,
	type UnknownValueScope,
	type ValueScope,
	type ScopeTemplate,
} from '../../core/value-scope.js';

const base = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
});

// ── extendValues — field layer ──────────────────────────────────────

const withFields = base.extendValues({
	age: value(0),
	role: value('viewer'),
});
const wfInst = withFields.create({ firstName: 'Bob' });
expectTypeOf(wfInst.firstName.get()).toEqualTypeOf<string | undefined>();
expectTypeOf(wfInst.age.get()).toEqualTypeOf<number>();
expectTypeOf(wfInst.role.get()).toEqualTypeOf<string>();

// ── extendValues — derivation layer (against base Def) ──────────────

const withDeriv = base.extendValues({
	fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
});
const wdInst = withDeriv.create();
expectTypeOf(wdInst.fullName.get()).toEqualTypeOf<string>();

// ── extendValues — (fields, derivations) layered ────────────────────

const withFieldsAndDeriv = base.extendValues(
	{ title: value<string>() },
	{
		label: ({ scope }) => {
			expectTypeOf(scope.firstName.use()).toEqualTypeOf<string | undefined>();
			expectTypeOf(scope.title.use()).toEqualTypeOf<string | undefined>();
			return `${scope.firstName.use()} — ${scope.title.use()}`;
		},
	},
);
const wfadInst = withFieldsAndDeriv.create();
expectTypeOf(wfadInst.label.get()).toEqualTypeOf<string>();

// ── extendValues then extendConfig — strict scope inside hooks ──────

const withConfig = base.extendValues({ age: value(0) }).extendConfig({
	onCreate: ({ scope }) => {
		expectTypeOf(scope.firstName.get()).toEqualTypeOf<string | undefined>();
		expectTypeOf(scope.age.get()).toEqualTypeOf<number>();
	},
});
expectTypeOf(withConfig.create).toBeFunction();

// ── extendValues with deriv layer, then extendConfig ────────────────

const fullChain = base
	.extendValues(
		{ age: value(0) },
		{ displayAge: ({ scope }) => `${scope.age.use()} years` },
	)
	.extendConfig({
		onCreate: ({ scope }) => {
			expectTypeOf(scope.age.get()).toEqualTypeOf<number>();
			expectTypeOf(scope.displayAge.get()).toEqualTypeOf<string>();
		},
	});
expectTypeOf(fullChain.create).toBeFunction();

// ── Override a base field via extendValues ──────────────────────────

const overrideField = base.extendValues({
	firstName: value('default-name'),
});
const ofInst = overrideField.create();
expectTypeOf(ofInst.firstName.get()).toEqualTypeOf<string>();

// ── Chained extendValues accumulates types ──────────────────────────

const chained = base
	.extendValues({ age: value(0) })
	.extendValues({ role: value('viewer') })
	.extendValues({
		summary: ({ scope }) =>
			`${scope.firstName.use()} (${scope.role.use()}, ${scope.age.use()})`,
	});
const chInst = chained.create();
expectTypeOf(chInst.summary.get()).toEqualTypeOf<string>();

// ── UnknownValueScope cast — middleware pattern ─────────────────────

function attachHistory<Def extends Record<string, unknown>>(
	template: ScopeTemplate<Def>,
): ScopeTemplate<Def> {
	// Cast widens Def so the lifecycle hook's scope is GenericScopeInstance,
	// making attached-property writes type-check.
	return asUnknownValueScope(template).extendConfig({
		onCreate: ({ scope }) => {
			scope.$undo = () => {};
			scope.$canUndo = false;
		},
	}) as unknown as ScopeTemplate<Def>;
}
const histInst = attachHistory(base).create();
expectTypeOf(histInst.firstName.get()).toEqualTypeOf<string | undefined>();

// ── ValueScope<R> — middleware that requires specific fields ────────

function logsCount<
	Def extends ValueScope<{ count: ReturnType<typeof value<number>> }>,
>(template: ScopeTemplate<Def>): ScopeTemplate<Def> {
	return template.extendConfig({
		onChange: ({ scope }) => {
			// scope inside hooks remains generic (HookScope union) — typed
			// access requires a snapshot read or an explicit narrow cast.
			void scope.$getSnapshot();
		},
	});
}

const counter = valueScope({ count: value(0), name: value('counter') });
const tracked = logsCount(counter);
expectTypeOf(tracked.create().count.get()).toBeNumber();

// ── ValueScope<R> rejects templates without required fields ─────────

const noCounter = valueScope({ name: value('noCounter') });
// @ts-expect-error — missing required `count` field
logsCount(noCounter);

// ── UnknownValueScope as direct param (caller must cast) ────────────

declare function shapeAgnosticMiddleware(
	t: UnknownValueScope,
): UnknownValueScope;
// Direct call requires explicit cast because ScopeTemplate is invariant
shapeAgnosticMiddleware(asUnknownValueScope(base));
