/**
 * Type-level tests for valueScope's variadic overload behavior.
 *
 * @see docs/extending.md
 *
 * Pins the user-observable contract:
 *  - 1-arg field-only form works
 *  - 2-arg form: (fields, deriv-layer) AND (fields, config-layer)
 *    are disambiguated by overload preference (config-first)
 *  - Cross-layer typing: derivations see prior layers' fields
 *  - Siblings in the same derivation layer are not visible
 *  - Functions in the field-layer slot are rejected at the type level
 *  - Values in the derivation-layer slot are rejected at the type level
 *  - Async derivations get { signal, set, onCleanup, previousValue }
 *  - Up to 11 derivation layers (arity 13 = field + 11 derivs + config)
 *
 * RED until the variadic refactor lands.
 */

import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import { valueScope } from '../../core/value-scope.js';

// ── 1-arg: field layer only ─────────────────────────────────────────

const oneArg = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
});
const oneInst = oneArg.create({ firstName: 'a', lastName: 'b' });
expectTypeOf(oneInst.firstName.get()).toEqualTypeOf<string | undefined>();

// ── 2-arg: (fields, config) — onCreate is a hook, scope typed ───────

const fieldsPlusConfig = valueScope(
	{ firstName: value<string>() },
	{
		onCreate: ({ scope }) => {
			// scope.firstName is the live instance (hook context), not a wrapper
			expectTypeOf(scope.firstName.get()).toEqualTypeOf<string | undefined>();
		},
	},
);
expectTypeOf(fieldsPlusConfig.create).toBeFunction();

// ── 2-arg: (fields, derivation-layer) — derivation scope typed ──────

const fieldsPlusDeriv = valueScope(
	{
		firstName: value<string>(),
		lastName: value<string>(),
	},
	{
		fullName: ({ scope }) => {
			// scope.firstName.use() returns string | undefined (the deriv wrapper)
			expectTypeOf(scope.firstName.use()).toEqualTypeOf<string | undefined>();
			expectTypeOf(scope.lastName.use()).toEqualTypeOf<string | undefined>();
			return `${scope.firstName.use()} ${scope.lastName.use()}`;
		},
	},
);
const fpdInst = fieldsPlusDeriv.create();
// fullName is on the final instance
expectTypeOf(fpdInst.fullName.get()).toEqualTypeOf<string>();

// ── 3-arg: (fields, deriv, config) — config sees full Def ───────────

const threeArg = valueScope(
	{ price: value(0), qty: value(0) },
	{
		subtotal: ({ scope }) => scope.price.use() * scope.qty.use(),
	},
	{
		onCreate: ({ scope }) => {
			// Hook scope sees both fields AND the derivation
			expectTypeOf(scope.price.get()).toEqualTypeOf<number>();
			expectTypeOf(scope.subtotal.get()).toEqualTypeOf<number>();
		},
	},
);
expectTypeOf(threeArg.create).toBeFunction();

// ── Cross-layer typing: L3 sees L1+L2 ───────────────────────────────

const crossLayer = valueScope(
	{ price: value(0), qty: value(0) },
	{ subtotal: ({ scope }) => scope.price.use() * scope.qty.use() },
	{ tax: ({ scope }) => scope.subtotal.use() * 0.1 },
	{ total: ({ scope }) => scope.subtotal.use() + scope.tax.use() },
);
const clInst = crossLayer.create();
expectTypeOf(clInst.total.get()).toEqualTypeOf<number>();

// ── Sibling exclusion: siblings in same layer are NOT visible ───────

valueScope(
	{ a: value(0) },
	{
		b: ({ scope }) => scope.a.use() + 1,
		// @ts-expect-error — sibling `b` is being defined in this layer; not on `scope`
		c: ({ scope }) => scope.b.use() + 1,
	},
);

// ── Crossover guards: function in field-layer slot is rejected ──────
//
// PENDING (step 5 migration): the legacy `valueScope(definition, config?)`
// overload still accepts function-in-field-layer literals. Once the
// legacy overload is removed, the FieldLayer constraint will fire and
// these `@ts-expect-error` directives become active.
//
// valueScope({
//   greeting: (ctx: { scope: unknown }) => 'hi',
// });

// Value in derivation layer slot — rejected at the DerivationLayer constraint.
valueScope(
	{ a: value(0) },
	{
		// @ts-expect-error — Value not callable, fails the function-shaped slot
		b: value('x'),
	},
);

// ── Async derivations: ctx exposes signal/set/onCleanup/previousValue ──

const asyncForm = valueScope(
	{ userId: value<string>() },
	{
		profile: async ({ scope, signal, set, onCleanup, previousValue }) => {
			expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
			expectTypeOf(set).toBeFunction();
			expectTypeOf(onCleanup).toBeFunction();
			expectTypeOf(previousValue).toEqualTypeOf<unknown>();
			const id = scope.userId.use();
			return id ? { id } : undefined;
		},
	},
);
expectTypeOf(asyncForm.create).toBeFunction();

// ── Hook-name disambiguation: derivation literally named `onCreate` ──

// Without a trailing config layer, `{ onCreate: ... }` in the 2-arg slot
// is treated as the config layer (the config-first overload wins).
const onCreateAsHook = valueScope(
	{ foo: value(0) },
	{
		onCreate: ({ scope }) => {
			expectTypeOf(scope.foo.get()).toEqualTypeOf<number>();
		},
	},
);
expectTypeOf(onCreateAsHook.create).toBeFunction();

// With a trailing {} as the disambiguator, `onCreate` becomes a derivation.
const onCreateAsDeriv = valueScope(
	{ foo: value(0) },
	{ onCreate: ({ scope }) => scope.foo.use() * 2 },
	{},
);
const inst = onCreateAsDeriv.create();
// `onCreate` is now a derivation field on the instance
expectTypeOf(inst.onCreate.get()).toEqualTypeOf<number>();

// ── Arity cap: 1 field + 11 deriv layers + config = 13 args ─────────

// Deeply chained derivations through every layer.
const maxArity = valueScope(
	{ a: value(0) },
	{ b: ({ scope }) => scope.a.use() + 1 },
	{ c: ({ scope }) => scope.b.use() + 1 },
	{ d: ({ scope }) => scope.c.use() + 1 },
	{ e: ({ scope }) => scope.d.use() + 1 },
	{ f: ({ scope }) => scope.e.use() + 1 },
	{ g: ({ scope }) => scope.f.use() + 1 },
	{ h: ({ scope }) => scope.g.use() + 1 },
	{ i: ({ scope }) => scope.h.use() + 1 },
	{ j: ({ scope }) => scope.i.use() + 1 },
	{ k: ({ scope }) => scope.j.use() + 1 },
	{ l: ({ scope }) => scope.k.use() + 1 },
	{
		onCreate: ({ scope }) => {
			expectTypeOf(scope.a.get()).toEqualTypeOf<number>();
			expectTypeOf(scope.l.get()).toEqualTypeOf<number>();
		},
	},
);
expectTypeOf(maxArity.create).toBeFunction();
