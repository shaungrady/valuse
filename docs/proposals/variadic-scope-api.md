# Variadic Scope API — User-Facing Design

> **Status: Implemented (with revisions).** See [extending.md](../extending.md)
> for the shipped API. This proposal documented the original unified-`.extend()`
> design; during implementation the extension surface was split into two methods
> to side-step a structural TypeScript limitation. See
> [Final implementation](#final-implementation) below for the summary.
>
> `valueScope()` ships as proposed: variadic
> `(fieldLayer, ...derivLayers, config?)`.

## Final implementation

The `valueScope()` design landed unchanged: variadic, layered, with the trailing
config slot discriminated by `LastDerivationLayer`. Arities 1–13 are
implemented.

The `.extend()` portion was **split into two methods** rather than a single
variadic call:

- `.extendValues(values, ...derivLayers)` — strict, variadic, mirrors
  `valueScope()`'s field-and-derivation shape minus the trailing config slot.
  Arities 1–12.
- `.extendConfig(config)` — strict single-arg method that attaches lifecycle
  hooks without changing the definition.

**Why split:** generic middleware writes `template.extend({}, config)` to attach
lifecycle hooks to an unknown shape. With a unified `.extend()` that threads the
merged `Def` through to the config slot's `ScopeConfig<Def>`, the hooks'
`HookScope<Def>` resolves to a _union_ of
`GenericScopeInstance | ScopeInstance<Def>` for generic `Def` — TS can't pick a
branch, and writes to dynamically-attached `$`-methods (e.g. `scope.$undo = …`
in `withHistory`) fail at the type level.

We investigated four type-level fixes (intersection, infer-binding, brand-based
identity, type-fest `MergeDeep`) and none resolved the union problem cleanly —
it's intrinsic to TS's conditional-type semantics on generic constraints. The
structural fix that _does_ work is to give middleware an explicit widening
primitive instead:

- `UnknownValueScope` (= `ScopeTemplate<Record<string, unknown>>`) and
  `asUnknownValueScope(template)` cast the template at the middleware boundary
  so the hook's `Def` is eagerly the loose default, picking the
  `GenericScopeInstance` branch.
- `ValueScope<RequiredDef>` is a definition-shape constraint helper:
  `Def extends ValueScope<{ field: Value<…> }>` requires the input template to
  declare specific values.

The split has a small ergonomic cost (one more method call for the
fields-plus-config combo) but avoids content-based last-slot discrimination on
`.extend()`, simplifies the overload table, and keeps the user-facing type
safety strict where users care while giving middleware a typed escape hatch.

See [extending.md](../extending.md) for the shipped API surface and worked
examples.

---

## Motivation

The current `valueScope({...})` unified form requires a manual
`({scope}: SyncDerivationContext<typeof fields>)` annotation on every
derivation, because TypeScript cannot contextually type a derivation's `scope`
parameter from the surrounding object literal (circular inference: `Def` is
being inferred from an object containing functions whose contextual types depend
on `Def`).

The variadic API separates fields, derivations, and config into three kinds of
positional **Layers**, letting TS pin `Def` step-by-step and fully infer
derivation scope without any annotation. Each layer builds on the layers before
it.

## The rule

```
valueScope(
  fieldLayer,             // arg 1: required, Field Layer
  ...derivationLayers,    // args 2..N-1: zero or more Derivation Layers
  configLayer?,           // last arg: optional Config Layer
);
```

- **Field Layer** (arg 1, exactly one). `value()`, `valueRef()`, `valueArray()`,
  `valuePlain()`, nested groups, etc. No derivation functions.
- **Derivation Layer** (middle args, zero or more). Each layer is
  `Record<string, ({scope}) => value>`. Each layer's `scope` sees the Field
  Layer plus all prior Derivation Layers.
- **Config Layer** (last arg, optional). Lifecycle hooks (`onCreate`,
  `onChange`, etc.) and options (`allowUndeclaredProperties`). Hook `scope` sees
  the full `Def` — Field Layer plus every Derivation Layer.

Within a single Derivation Layer, siblings are _not_ accessible. To have
derivation `B` read derivation `A`, declare `A` in a Derivation Layer earlier
than `B`. This makes circular derivations structurally impossible: the DAG flows
strictly left-to-right.

### Layers deep-merge into Def

The Field Layer and every Derivation Layer **deep-merge** into the final `Def`.
Plain-object groups in the Field Layer pass through to the final `Def`; reactive
instances (`Value`, `ValueRef`, etc.) and functions are leaves and replace each
other on collision (which the runtime shadow check then rejects in
`valueScope`).

**Nested-group derivations (a derivation defined inside a group) are NOT
supported in v1.** Mirroring a Field Layer group in a Derivation Layer to add a
derivation inside it is a planned-out-of-scope feature. Use **scope
composition** instead: extract the group into its own scope template and
reference it via `valueRef`. See "Nested groups" below.

The **Config Layer does not merge into Def** — it attaches behavior (hooks,
options) to the template. Its keys are `ScopeConfig` keys, not user keys, and
never appear on `scope`.

### Reserved key names? No — disambiguate with a trailing `{}`

Names like `onCreate`, `onChange`, etc. are special only when the object lives
in the Config Layer slot (the last arg). In any Derivation Layer they're just
regular keys. If you want a derivation literally named `onCreate`, put an empty
`{}` as the Config Layer so the previous arg is unambiguously a Derivation
Layer:

```ts
valueScope(
  { foo: value<number>(0) },
  { onCreate: ({ scope }) => scope.foo.use() * 2 }, // a derivation
  {}, // empty Config Layer disambiguator
);
```

Both can coexist — a derivation named `onCreate` (in a Derivation Layer) and a
real `onCreate` hook (in the Config Layer):

```ts
valueScope(
  { foo: value<number>(0) },
  { onCreate: ({ scope }) => scope.foo.use() * 2 }, // derivation
  { onCreate: ({ scope }) => log(scope.onCreate.use()) }, // hook
);
```

## Shapes

```ts
// Field Layer only.
valueScope({ name: value<string>('') });

// Field Layer + Config Layer.
valueScope(
  { name: value<string>('') },
  {
    onCreate: ({ scope }) => {
      /* scope: { name: FieldValue<string> } */
    },
  },
);

// Field Layer + one Derivation Layer.
valueScope(
  { firstName: value<string>(''), lastName: value<string>('') },
  {
    fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
  },
);

// Field Layer + Derivation Layer + Config Layer.
valueScope(
  { price: value<number>(0), quantity: value<number>(0) },
  { subtotal: ({ scope }) => scope.price.use() * scope.quantity.use() },
  {
    onCreate: ({ scope }) => {
      // scope.subtotal is typed (a FieldDerived<number>).
    },
  },
);

// Cross-derivation across multiple Derivation Layers.
valueScope(
  { price: value<number>(0), quantity: value<number>(0) },
  { subtotal: ({ scope }) => scope.price.use() * scope.quantity.use() },
  { tax: ({ scope }) => scope.subtotal.use() * 0.1 }, // sees subtotal
  { total: ({ scope }) => scope.subtotal.use() + scope.tax.use() },
  {
    onChange: ({ scope, changes }) => {
      /* full Def */
    },
  },
);
```

## Refs and scope factories

Refs and `createMap` factories live in the Field Layer unchanged. Derivations
read them via `scope.<key>.use()`, which returns the resolved ref value (e.g., a
`ScopeMap`).

```ts
const boardScope = valueScope(
  // Field Layer
  {
    boardId: value<string>(),
    cards: valueRef(() => cardScope.createMap<string>()),
    columns: valueRef(() => columnScope.createMap<string>()),
  },
  // Derivation Layer 1 — fetches over the field
  {
    data: async ({ scope, signal }) => fetchBoard(scope.boardId.use(), signal),
  },
  // Derivation Layer 2 — reads both fields and Derivation Layer 1
  {
    name: ({ scope }) => scope.data.use()?.name ?? 'Loading...',
    columnCount: ({ scope }) => scope.columns.use().size,
  },
  // Config Layer — sees the full Def
  {
    onChange: ({ scope, changes }) => {
      if (changes.has('data')) {
        const data = scope.data.get();
        for (const c of data?.cards ?? []) scope.cards.set(c.id, c);
      }
    },
  },
);
```

## Nested groups

A pure group field (`job: { title: value<string>('') }`) lives in the Field
Layer and passes through to the final `Def` unchanged. Plain nested structure is
fine.

**Derivations inside nested groups are not supported in v1.** Use scope
composition instead — factor the group into its own scope template and reference
it via `valueRef`:

```ts
const jobScope = valueScope(
  { title: value<string>('') },
  { label: ({ scope }) => scope.title.use().toUpperCase() },
);

valueScope(
  {
    name: value<string>(''),
    job: valueRef(() => jobScope.create()),
  },
  {
    greeting: ({ scope }) =>
      `${scope.name.use()} (${scope.job.use().label.use()})`,
  },
);
```

This pattern is the recommended design even where nested derivations would work
— it isolates each scope's lifecycle and gives each piece its own derivation
graph. Nested-group derivations are tracked as deferred work in the technical
section; the current cost (two parallel recursive type machines,
inference-stability risk, worse error messages) is not worth shipping until the
flat case has real-world miles.

## `.extend()`

`.extend()` takes the same Layer-based shape, with one structural difference:
the **first arg may be a Field Layer or a Derivation Layer**, discriminated by
content. Fields are reactive instances (`Value`, `ValueRef`, etc.); derivations
are functions.

```ts
// Extend with a Field Layer + Derivation Layer + Config Layer:
baseTemplate.extend(
  { newField: value<string>('') },
  { newDeriv: ({ scope }) => '...' },
  { onCreate: ({ scope }) => {} },
);

// Extend with only a Derivation Layer:
baseTemplate.extend({ newDeriv: ({ scope }) => '...' });
```

### Override semantics

Unlike `valueScope` (where collisions across layers throw at build), `.extend()`
allows overriding base keys. Override is the feature.

- Field-in-extend overrides field-in-base: replaces the field.
- Field-in-extend overrides derivation-in-base: the key becomes a field.
- Derivation-in-extend overrides field-in-base: the key becomes a derivation.
- Derivation-in-extend overrides derivation-in-base: the new derivation
  replaces.
- `undefined` value in a Field Layer of an extend removes the key entirely.

### Self-exclusion in extend Derivation Layers

A derivation in an extend Derivation Layer cannot read its own key. If `extend`
defines a derivation for key `foo`, then `scope.foo` is **not** accessible
inside that derivation's body. (Otherwise the derivation would self-reference,
which is a guaranteed cycle.)

```ts
// ❌ scope.foo is not in scope, because foo is being defined in this layer.
baseTemplate.extend({
  foo: ({ scope }) => scope.foo.use(),
});
```

For "transform existing field's incoming data", use a pipe on a redefined value,
not a derivation override:

```ts
// ✓ Redefine the value with a transform.
baseTemplate.extend({
  name: value<string>('').pipe((s) => s.toUpperCase()),
});
```

## Safety summary

| Concern                                                                         | Status                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Cross-derivation typing across layers                                           | Type-level                                                                                                               |
| Circular derivations across layers                                              | Structurally impossible (DAG flows left to right)                                                                        |
| Sibling-in-same-layer reads                                                     | Type-level (sibling not on `scope` yet)                                                                                  |
| Hooks see the full Def                                                          | Type-level                                                                                                               |
| Hook-reserved key inside a Derivation Layer                                     | Allowed — names are only reserved at the Config Layer position                                                           |
| Hook-reserved key in the Config Layer slot                                      | Treated as config (the intended semantic); add a trailing `{}` Config Layer to make the prior arg a Derivation Layer     |
| Field/derivation key collision across `valueScope` layers (at any depth)        | Runtime check (throws at template build)                                                                                 |
| Field/derivation key override in `.extend`                                      | Allowed (the feature)                                                                                                    |
| Function in Field Layer slot / Value in Derivation Layer slot                   | Type-level (via `FieldEntry<T>` and `DerivationLayer`'s function signature)                                              |
| Sibling reads inside an extend Derivation Layer                                 | Type-level (`Omit<Prior, keyof L>` works for siblings)                                                                   |
| Self-reads inside an extend Derivation Layer (`name: ({scope}) => scope.name…`) | Runtime only — Preact-signals computed throws on self-reference. Type-level Omit doesn't fire due to TS inference order. |
| Nested-group derivations (e.g., `{ job: { label: ({scope}) => … } }`)           | **Not supported in v1.** Use scope composition (`valueRef` to a separate scope template).                                |

# TypeScript Types and Technical Approach

> **Validation status (2026-05-22):** every type-level claim in this section has
> been validated in standalone playground fixtures (Option A unified ctx, 13-arg
> overload set, `.extend()` discrimination, crossover guards, `DeepMerge`). The
> one type-level intent that did **not** survive validation
> (`Omit<Prior, keyof L>` self-exclusion in `.extend()`) is called out below
> with the runtime fallback.

## Core types

```ts
// Wrapper around a single Def entry as seen inside a derivation body.
// `.use()` returns the value directly (NOT a [value, setter] tuple).
type DerivLeaf<T> =
  T extends Value<infer V> ? { get(): V; use(): V }
  : T extends ValueRef<infer S> ?
    { get(): ResolvedRef<S>; use(): ResolvedRef<S> }
  : T extends ValuePlain<infer V, boolean> ? { get(): V; use(): V }
  : T extends ValueSchema<any, infer V> ? { get(): V; use(): V }
  : T extends ValueArray<any, infer Out> ? { get(): Out[]; use(): Out[] }
  : T extends ValueMap<infer K, infer V> ?
    { get(): Map<K, V>; use(): Map<K, V> }
  : T extends ValueSet<infer V> ? { get(): Set<V>; use(): Set<V> }
  : T extends (...args: any) => Promise<infer R> ?
    { get(): R | undefined; use(): R | undefined }
  : T extends (...args: any) => infer R ? { get(): R; use(): R }
  : never;

// Mapped over Def: each leaf becomes a `{get, use}` wrapper.
type DerivScope<Def extends Record<string, unknown>> = {
  readonly [K in keyof Def]: DerivLeaf<Def[K]>;
};

// Unified context for sync AND async derivations (Option A). All five
// fields are always provided by the runtime, but only `scope` is
// meaningful for sync derivations — `signal`, `set`, `onCleanup`, and
// `previousValue` exist on the ctx because TS can't discriminate
// per-entry between sync and async slots (see "What was tried and
// rejected"). Sync derivations ignore those four fields.
//
// Upside of the unified shape: swapping a derivation from sync to
// async (or back) is a one-keyword change — no ctx-type swap required.
//
// `set` and `previousValue` are loosely typed because the streamed
// value type can't be inferred from a value-returning function.
type DerivCtx<Prior> = {
  scope: DerivScope<Prior>;
  signal: AbortSignal;
  set: (value: unknown) => void;
  onCleanup: (fn: () => void) => void;
  previousValue: unknown;
};

// Deep layer merge: B deep-merges into A. Plain-object groups recurse;
// leaves (Value, ValueRef, function, etc.) follow shallow-override
// semantics (B replaces A). `IsGroup<T>` distinguishes plain-object
// groups from reactive instances and is reused from scope-types.ts.
type DeepMerge<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B ?
    K extends keyof A ?
      IsGroup<A[K]> extends true ?
        IsGroup<B[K]> extends true ?
          DeepMerge<A[K], B[K]>
        : B[K]
      : B[K]
    : B[K]
  : K extends keyof A ? A[K]
  : never;
};

// Type expected at a Derivation Layer arg slot: each entry is a function
// whose ctx is contextually typed against Prior. No key-name
// restrictions — Config Layer disambiguation happens via overload
// preference at the last arg.
//
// IMPORTANT: do NOT add a `L extends Record<string, (ctx: any) => any>`
// constraint to the overloads. That constraint poisons contextual
// typing with `any` and lets sync derivs destructure async-only fields
// without error. The intersected slot type alone provides the
// contextual function shape.
type DerivationLayer<Prior, L> = {
  [K in keyof L]: (ctx: DerivCtx<Prior>) => unknown;
};

// Field Layer entry constraint — rejects functions so a function in
// the Field Layer slot fails at the type level. Validated.
type FieldEntry<T> = T extends (...args: any[]) => any ? never : T;
type FieldLayer<L> = { [K in keyof L]: FieldEntry<L[K]> };

// Same shape as DerivationLayer, but for `.extend()` — best-effort
// self/sibling exclusion via Omit. Sibling exclusion works at the type
// level. Self-exclusion (deriv overrides a base key and reads
// scope.<sameKey>) does NOT fire because `keyof L` resolves to `never`
// during contextual typing — a known TS inference-order quirk. Runtime
// cycle detection (Preact-signals computed) catches actual self-cycles.
type ExtendDerivationLayer<Prior, L> = {
  [K in keyof L]: (ctx: {
    scope: DerivScope<Omit<Prior, keyof L>>;
    signal: AbortSignal;
    set: (value: unknown) => void;
    onCleanup: (fn: () => void) => void;
    previousValue: unknown;
  }) => unknown;
};
```

### `IsGroup` audit — three branches to add

The existing `IsGroup<T>` in `scope-types.ts` excludes `Value`, `ValueSchema`,
`ValuePlain`, `ValueRef`, and functions. It does **not** exclude `ValueArray`,
`ValueMap`, `ValueSet`, even though they're public API and the runtime correctly
handles them as per-instance reactive collections. Today users must cast through
`as any` to put them in a scope definition (see `value-scope.test.ts:1609`).

`DeepMerge` will misclassify these as nested groups unless we add:

```ts
type IsGroup<T> =
  T extends Value<any, any> ? false
  : T extends ValueSchema<any, any> ? false
  : T extends ValuePlain<any, any> ? false
  : T extends ValueRef<any> ? false
  : T extends ValueArray<any, any> ?
    false // NEW
  : T extends ValueMap<any, any> ?
    false // NEW
  : T extends ValueSet<any> ?
    false // NEW
  : T extends (...args: any[]) => any ? false
  : T extends Record<string, unknown> ? true
  : false;
```

`MapEntry` needs matching branches that map these to their `Field*`
counterparts.

## Overload structure

`valueScope` is declared as a series of per-arity overloads. The cap is **1
Field Layer + 11 Derivation Layers + optional Config Layer** = arities 1..13,
~25 overloads total. Past 11 Derivation Layers, users compose via `.extend()`.

Each arity has up to two variants: one that ends in a Config Layer slot, and one
whose last arg is still a Derivation Layer.

```ts
// 1 arg
declare function valueScope<L1 extends Record<string, unknown>>(
  l1: L1 & FieldLayer<L1>,
): ScopeTemplate<L1>;

// 2 args: fields + config OR fields + deriv-layer
declare function valueScope<L1 extends Record<string, unknown>>(
  l1: L1 & FieldLayer<L1>,
  config: ScopeConfig<L1>,
): ScopeTemplate<L1>;
declare function valueScope<L1 extends Record<string, unknown>, L2>(
  l1: L1 & FieldLayer<L1>,
  l2: L2 & DerivationLayer<L1, L2>,
): ScopeTemplate<DeepMerge<L1, L2>>;

// 3 args
declare function valueScope<L1 extends Record<string, unknown>, L2>(
  l1: L1 & FieldLayer<L1>,
  l2: L2 & DerivationLayer<L1, L2>,
  config: ScopeConfig<DeepMerge<L1, L2>>,
): ScopeTemplate<DeepMerge<L1, L2>>;
declare function valueScope<L1 extends Record<string, unknown>, L2, L3>(
  l1: L1 & FieldLayer<L1>,
  l2: L2 & DerivationLayer<L1, L2>,
  l3: L3 & DerivationLayer<DeepMerge<L1, L2>, L3>,
): ScopeTemplate<DeepMerge<DeepMerge<L1, L2>, L3>>;

// ... mechanical extension up through 13 args.
```

**Performance**: the full 13-arg form on a max-stress chain (every layer adding
a derivation that reads the previous) measured at 1.09s check time, 126k
instantiations, 165MB. Realistic usage at arity 2–4 is sub-0.5s.

**Why this works**: the `& DerivationLayer<Prior, L>` intersection provides
contextual function typing for each entry. `Prior` (the accumulated Def from
earlier layers) is fully pinned by the time TS types the next arg, so no
circularity. Critically, the generic on `L` is **unconstrained** (just `<L2>`,
not `<L2 extends Record<string, (ctx: any) => any>>`) — adding the
function-constraint to the generic poisons contextual typing with `any` and
silently allows sync derivs to access async-only ctx fields.

**Overload ordering**: at each arity, the Config-Layer-at-end overload is listed
_first_. A 2-arg call like `valueScope(fields, { onCreate: fn })` resolves to
the Config Layer overload (because it matches first), so `onCreate` becomes a
hook. A 3-arg call like `valueScope(fields, { onCreate: fn }, {})` resolves to
the Derivation-Layer-then-Config-Layer overload, so `onCreate` becomes a
derivation. This is the disambiguation rule for "I want a derivation named like
a hook."

## Config Layer vs Derivation Layer disambiguation

There is no type-level "reserved key" list. The decision of whether the last arg
is a Config Layer or a Derivation Layer is made by **overload preference**: at
each arity, the Config-Layer-at-end overload is listed _first_ and wins when
both overloads structurally match.

Concretely, for `valueScope(fields, { onCreate: fn })`:

- The 2-arg Config Layer overload (`l1: L1, config: ScopeConfig<L1>`) is tried
  first. `{ onCreate: fn }` matches `ScopeConfig<L1>`. TS picks it. → `onCreate`
  is a hook.

For `valueScope(fields, { onCreate: fn }, {})`:

- TS tries the 3-arg overloads (Derivation Layer then Config Layer).
  `{ onCreate: fn }` matches `DerivationLayer<L1, L2>` (no key restrictions).
  `{}` matches `ScopeConfig<...>`. → `onCreate` is a derivation; `{}` is the
  empty Config Layer.

This makes the trailing `{}` the canonical disambiguator when a user really
wants a derivation named after a hook.

## `.extend()` overload structure and discrimination

`.extend()` mirrors `valueScope`'s overload set, but its first arg may be a
Field Layer **or** a Derivation Layer (discriminated by content — overrides are
the feature). The discriminator variants are listed with **deriv-layer overloads
FIRST at each arity**, so that function-containing literals get correct
contextual typing before TS tries the field-layer overload.

```ts
interface ExtendFn<Base> {
  // 1 arg: deriv layer (listed first)
  <L1>(
    l1: L1 & ExtendDerivationLayer<Base, L1>,
  ): ScopeTemplate<DeepMerge<Base, L1>>;
  // 1 arg: field layer
  <L1>(l1: L1 & FieldLayer<L1>): ScopeTemplate<DeepMerge<Base, L1>>;

  // 2 args: deriv + config
  <L1>(
    l1: L1 & ExtendDerivationLayer<Base, L1>,
    config: ScopeConfig<DeepMerge<Base, L1>>,
  ): ScopeTemplate<DeepMerge<Base, L1>>;
  // 2 args: field + config
  <L1>(
    l1: L1 & FieldLayer<L1>,
    config: ScopeConfig<DeepMerge<Base, L1>>,
  ): ScopeTemplate<DeepMerge<Base, L1>>;
  // 2 args: field + deriv
  <L1, L2>(
    l1: L1 & FieldLayer<L1>,
    l2: L2 & ExtendDerivationLayer<DeepMerge<Base, L1>, L2>,
  ): ScopeTemplate<DeepMerge<DeepMerge<Base, L1>, L2>>;

  // ... mechanical extension to match valueScope's arity cap.
}
```

A layer with mixed entries (some fields, some derivations) fails both the
`FieldLayer` and `ExtendDerivationLayer` constraints, producing an
overload-mismatch error.

### Self-exclusion in extend Derivation Layers (best-effort)

`ExtendDerivationLayer<Prior, L>` types `scope` as
`DerivScope<Omit<Prior, keyof L>>`. The intent:

- Sibling reads inside the same extend Derivation Layer are blocked.
- Self-reads of overridden keys are blocked.

**Sibling exclusion works.** Self-exclusion **does not fire** at the type level
— `keyof L` resolves to `never` during contextual typing (a known TS
inference-order quirk; the analog of the shadow check that destabilizes
inference in the rejected approaches below). A user writing
`base.extend({ name: ({ scope }) => scope.name.use() })` will not get a compile
error.

**Runtime fallback**: Preact-signals computed values throw on direct
self-reference, so actual cycles surface at runtime as the deriv first computes.
This is a known limitation, not a silent footgun — the worst case is a runtime
error instead of a compile error for the self-reference case.

## Deep merge across layers

The Field Layer and every Derivation Layer deep-merge into the final `Def`.
Plain-object groups recurse; reactive instances and functions are leaves that
follow shallow-override semantics. `IsGroup<T>` (already in `scope-types.ts`)
distinguishes plain-object groups from reactive instances like `Value`,
`ValueRef`, etc.

This is what lets a nested-group field be extended by a mirroring
nested-derivation entry in a later Derivation Layer (see "Nested groups" in the
user-facing design). At the type level, layer accumulation uses
`DeepMerge<Prior, Next>` instead of a shallow `Omit<A, keyof B> & B`. At
runtime, the shadow check walks layers depth-first and throws on collision at
any depth.

The Config Layer is **not** merged into `Def`. It's a separate argument that
attaches behavior (hooks, options) to the template — its keys are `ScopeConfig`
keys and never appear on `scope`.

## Runtime shadow validation

Type-level shadow detection across `valueScope` layers (forbidding a later-layer
key from colliding with an earlier-layer key) is intentionally **not** enforced
at the type level. Attempts to express it (e.g.,
`K extends keyof Prior ? never : ...`) destabilize inference: when TS computes
Derivation Layer N's slot type, Layer N-1's generic may not yet be fully
resolved, causing all keys to be flagged as shadowing under conservative
resolution.

Shadow detection is instead implemented in `value-scope.ts` at template-build
time. It walks layers recursively so a nested-group field can be safely extended
by a mirroring nested entry in a later Derivation Layer, but collisions at any
depth still throw:

```ts
function validateNoShadowing(layers: Record<string, unknown>[]): void {
  const seenPaths = new Set<string>();
  const collect = (layer: Record<string, unknown>, prefix: string) => {
    for (const [key, val] of Object.entries(layer)) {
      const path = prefix ? `${prefix}.${key}` : key;
      // Recurse into plain-object groups; leaves register their full path.
      if (isPlainGroup(val)) {
        collect(val as Record<string, unknown>, path);
      } else {
        if (seenPaths.has(path)) {
          throw new Error(
            `valueScope: duplicate key "${path}" across layers — ` +
              `each layer must add new keys. Use .extend() to override.`,
          );
        }
        seenPaths.add(path);
      }
    }
  };
  for (const layer of layers) collect(layer, '');
}
```

`.extend()` skips this validation — override is the feature.

## What was tried and rejected

These were validated to _not_ work and are recorded so we don't relitigate:

- **Single-object unified form with `NoInfer<T>`**: circular inference, `scope`
  stays `any`.
- **Single-object form with default generic param
  `$ = DerivScope<NonFunctionEntries<Def>>`**: the constraint on function
  entries still depends on `Def`, circularity remains.
- **Single-object form with `` K extends `${string}$` `` sigil partitioning**:
  works for contextual typing of fields, but sibling derivation reads collapse
  to `unknown` because preserving return-type inference through the slot
  constraint is not feasible.
- **Chained `.derive().derive().config()`**: works for typing but the DX cost
  (multiple calls, learning `.config()` placement) was rejected in favor of the
  variadic Layer shape.
- **Per-layer `keyof Prior` shadow check inside `DerivationLayer`**:
  destabilizes inference order; Derivation Layer N's slot resolves before Layer
  N-1's generic settles, flagging all keys as shadows.
- **Per-entry sync/async context discrimination via
  `L[K] extends (...) => Promise<any>`**: validated three variants, all have
  correctness gaps. With a wide `(ctx: any) => any` generic constraint on `L`,
  async is typed correctly but sync derivs can destructure async fields (false
  negative). Without the wide constraint, sync is properly constrained but async
  loses `AsyncCtx` (false negative). With an overloaded function type
  (intersection of sync + async call signatures), sync derivs can't satisfy both
  signatures and async derivs see a union ctx. Settled on Option A (single
  unified `DerivCtx`) — see `Core types` above. The accepted cost:
  `signal`/`set`/`onCleanup`/`previousValue` show up in IntelliSense on sync
  derivs even though they're only meaningful for async. The accepted benefit:
  swapping sync↔async is a one-keyword change.
- **Per-entry `Omit<Prior, keyof L>` self-exclusion in `.extend()`**: sibling
  exclusion works; self-redefinition exclusion does not. `keyof L` resolves to
  `never` during contextual typing — same inference-order quirk that breaks the
  shadow check above. Runtime cycle detection catches actual self-cycles. See
  "Self-exclusion" above.

## Open work (implementation order)

1. **`IsGroup` + `MapEntry` updates**: add `ValueArray` / `ValueMap` /
   `ValueSet` branches before any `DeepMerge` work.
2. **Hand-rolled `DeepMerge`**: validated against 10 realistic fixtures; no need
   to add `type-fest` as a dep just for this.
3. **`DerivLeaf`, `DerivScope`, `DerivCtx`, `DerivationLayer`,
   `ExtendDerivationLayer`, `FieldLayer`**: core types, port from playground.
4. **`valueScope` overload set**: arities 1..13 (~25 overloads),
   Config-Layer-first at each arity.
5. **`.extend()` overload set**: same arity cap, deriv-layer-first at each arity
   for contextual-typing precedence.
6. **Runtime shadow validation** in `value-scope.ts` (sketch in "Runtime shadow
   validation" below). Skipped for `.extend()`.
7. **Migration**: kanban model first (proving ground), then remaining 5
   examples, then prose docs (kanban-board.md, comparison docs).
8. **Removal of `SyncDerivationContext` / `AsyncDerivationContext` /
   `LifecycleHookContext`**: nothing is published yet, so these get deleted
   outright rather than `@deprecated`'d. Same applies to any other
   annotation-era surface area: just remove.

### Deferred (NOT in this refactor)

- **Nested-group Derivation Layer support**: requires a recursive
  `NestedDerivationLayer<Prior, L>` slot that walks groups, kept in sync with
  `DeepMerge`'s group-vs-leaf classification. Aliasing the type doesn't reduce
  the friction — two parallel recursions with hidden coupling,
  inference-stability risk, worse error messages, and an extra test-d surface.
  Document scope composition (extract the group into its own scope template and
  reference via `valueRef`) as the recommended pattern.
- **`type-fest` adoption**: `MergeDeep`, `Simplify`, etc. could swap in for the
  hand-rolled equivalents later. Hand-rolled passes all validation fixtures, and
  adding a dep just to swap implementations doesn't pay back yet. Revisit if
  hover-noise on intersections becomes a real complaint (`Simplify` is the most
  likely first win).
