# Scopes

A scope bundles related reactive state, derivations, and lifecycle hooks into a
reusable template. You define the shape once with `valueScope()`, then call
`.create()` to produce independent instances. Each instance has its own signals,
its own derivations, and its own lifecycle.

For composition across scopes, use [`valueRef`](refs.md) to point at live state
in another scope, and [`.extendValues()` / `.extendConfig()`](extending.md) to
layer additional values, derivations, and hooks onto an existing template.

## Table of contents

- [Defining a scope](#defining-a-scope)
- [Creating instances](#creating-instances)
- [Field access](#field-access)
- [Instance methods](#instance-methods)
- [Flushing pending work](#flushing-pending-work)
- [Snapshots](#snapshots)
- [Nesting](#nesting)
- [Plain data](#plain-data)
- [Non-reactive state with valuePlain](#non-reactive-state-with-valueplain)
- [Undeclared properties](#undeclared-properties)
- [Type inference](#type-inference)

---

## Defining a scope

A scope is defined with `valueScope()` and one or more **layers** passed as
positional arguments:

```
valueScope(
  fields,             // required
  ...derivations,     // optional, zero or more layers
  config?,            // optional
);
```

Each layer builds on the layers before it. Derivations see fields and earlier
derivations; lifecycle hooks see the full scope. Within a single derivation
layer, siblings are not visible to one another, which makes circular derivations
structurally impossible. The three subsections below cover each kind of layer in
detail.

### Why this shape

The layered form is what makes it possible for TypeScript to fully infer `scope`
inside derivations without a manual annotation. A single-object form like
`valueScope({ ...fields, ...derivations })` puts TS in a circular bind: the type
of the object depends on the derivation functions, whose parameter types depend
on the type of the object. Splitting the layers gives TS a ground truth (the
field layer) to pin first, then resolve each derivation layer against the
accumulated definition.

Type safety is the reason; clarity and correctness are real upsides:

- **Layers separate kinds of abstraction**: data is in one place, derived
  computation in another, side effects (hooks) in a third. The shape reads
  top-down by intent.
- **Circular derivations are structurally impossible**: the DAG flows strictly
  left to right across layers, and siblings within a layer cannot see one
  another. There is no syntax for `A` to read `B` while `B` reads `A`.
- **Dependency order is visible at the call site**: which derivation depends on
  which is encoded in layer placement, not buried in function bodies.

### Field layer

The first argument is the **field layer**, a plain object where each key is a
reactive primitive, a nested object, or static data:

| Entry type                    | What it becomes on the instance                  |
| ----------------------------- | ------------------------------------------------ |
| `value<T>()`                  | Reactive field with `.get()`, `.set()`, `.use()` |
| `valueSet<T>()`               | Reactive Set field                               |
| `valueMap<K,V>()`             | Reactive Map field                               |
| `valueArray<T>()`             | Reactive Array field                             |
| [`valueRef(source)`](refs.md) | Read-only reference to external state            |
| `valuePlain(...)`             | Non-reactive bookkeeping state                   |
| Plain object                  | Nested object (recurses; same rules apply)       |
| Anything else                 | Static readonly data                             |

```ts
import { value, valueScope, valueSet } from 'valuse';

const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  mood: value('happy'),
  hobbies: valueSet<string>(),
});
```

Derivation functions belong in a derivation layer, not the field layer; the type
system enforces this.

### Derivation layers

Zero or more arguments between the field layer and the optional config layer are
**derivation layers**. Each entry is a function whose `scope` parameter is
contextually typed against everything declared in earlier layers, with no manual
annotation required:

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    mood: value('happy'),
    hobbies: valueSet<string>(),
  },
  {
    fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
  },
);
```

For a derivation to read another derivation, declare the dependency in an
earlier layer:

```ts
const cart = valueScope(
  { price: value(0), quantity: value(0) },
  { subtotal: ({ scope }) => scope.price.use() * scope.quantity.use() },
  { tax: ({ scope }) => scope.subtotal.use() * 0.1 },
  { total: ({ scope }) => scope.subtotal.use() + scope.tax.use() },
);
```

Up to 11 derivation layers are supported. Past that, compose with
[`valueRef`](refs.md) or [`.extendValues()`](extending.md).

Async derivations live in derivation layers too. See
[Async derivations](async-derivations.md) for the full contract.

### Config layer

The optional last argument is the **config layer**: lifecycle hooks (`onCreate`,
`onChange`, `beforeChange`, `onDestroy`, `onUsed`, `onUnused`) and scope options
(`allowUndeclaredProperties`). Hook `scope` sees the full instance, including
every derivation layer:

```ts
const board = valueScope(
  { boardId: value<string>() },
  { name: ({ scope }) => scope.boardId.use() ?? 'untitled' },
  {
    onCreate: ({ scope }) => {
      // scope.boardId, scope.name are typed
    },
    allowUndeclaredProperties: true,
  },
);
```

Config layer keys are reserved names (`onCreate`, etc.) only at this slot
position. The same name in a derivation layer is just a regular derivation key,
no conflict. If you actually want a derivation named after a hook, add a
trailing `{}` as an empty config layer to disambiguate:

```ts
valueScope(
  { foo: value(0) },
  { onCreate: ({ scope }) => scope.foo.use() * 2 }, // a derivation
  {}, // empty config layer
);
```

The definition is processed once when `valueScope()` is called. The resulting
`ScopeTemplate` is a lightweight blueprint that can produce any number of
instances.

## Creating instances

```ts
const bob = person.create({
  firstName: 'Bob',
  lastName: 'Jones',
});
```

The input object is optional and partial. Only `value()` fields, async
derivation seeds, and nested objects accept input. Derivation keys are excluded
at the type level:

```ts
const empty = person.create(); // all fields start as default/undefined
const partial = person.create({ mood: 'ok' }); // only set mood
```

## Field access

Each reactive field on the instance is a wrapper object with its own methods.
Values have `.get()`, `.set()`, `.use()`, and `.subscribe()`. Derivations have
the same except `.set()`:

```ts
bob.firstName.get(); // 'Bob'
bob.firstName.set('Robert');
bob.firstName.set((prev) => prev.toUpperCase());

bob.fullName.get(); // 'ROBERT Jones'
// bob.fullName.set() — does not exist

bob.hobbies.add('climbing');
bob.hobbies.get(); // Set { 'climbing' }
```

In React, `.use()` returns tuples:

```tsx
const [firstName, setFirstName] = bob.firstName.use(); // [value, setter]
const [fullName] = bob.fullName.use(); // [value] — no setter
```

## Instance methods

Instance-level methods use a `$` prefix to stay out of the way of field names:

| Method           | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `$get()`         | Resolved values; scope refs stay as live instances              |
| `$getSnapshot()` | Plain data snapshot, recursively resolves nested scopes         |
| `$setSnapshot()` | Partial write to value fields                                   |
| `$use()`         | React hook, re-renders on any field change                      |
| `$subscribe(fn)` | Fires on any field change (see [Change hooks](change-hooks.md)) |
| `$recompute()`   | Re-run all derivations                                          |
| `$flush()`       | Expedite all pending deferred work, layer-ordered (see below)   |
| `$destroy()`     | Tear down the instance (see [Lifecycle](lifecycle.md))          |

```ts
bob.$subscribe(() => {
  console.log('something changed');
});

bob.$destroy(); // runs onDestroy hook, aborts async work, cleans up
```

## Flushing pending work

Many real interactions defer work: debounced inputs hold writes for a window,
async derivations sleep via `deferBy()`. `$flush()` on a scope instance commits
all of it in dependency order and resolves when the full cascade has settled:

```ts
async function submit() {
  await form.$flush();
  send(form.$getSnapshot());
}
```

The cascade follows the declared layer order: every field-layer entry flushes
first (committing any pipe-debounced writes), then each derivation layer in
turn, with the runtime awaiting the layer to settle before flushing the next.
This guarantees that downstream derivations see resolved upstream values, not
mid-flight intermediates.

Individual fields and derivations also expose `.flush(): Promise<void>`
directly:

- `valueField.flush()` — cascades through the pipe chain, expediting any
  in-flight `deferBy()` and awaiting other async work (fetches, uploads,
  microtask batches). Resolves when the signal commits.
- `asyncDeriv.flush()` — expedites the run's deferrals and resolves when it
  produces its next output (a `set()` emit or final `return`). Works on
  streaming derivations too. See
  [Flushing async derivations](async-derivations.md#flushing-async-derivations).
- Sync derivations expose `.flush()` too; the returned Promise resolves
  immediately (nothing to expedite).

Use cases that motivate this:

- **Form submit**: guarantee no stale debounced inputs before serializing.
- **Persistence**: `await scope.$flush()` before saving snapshots.
- **Tests**: deterministic settle without `vi.advanceTimersByTime()`.

## Snapshots

`$getSnapshot()` returns a plain object with all current values resolved. It is
a one-time read, not reactive:

```ts
bob.$getSnapshot();
// { firstName: 'Robert', lastName: 'Jones', mood: 'happy', fullName: 'Robert Jones' }
```

`$setSnapshot()` accepts a nested partial. Only reactive value fields are
written; derivations and static data are ignored:

```ts
bob.$setSnapshot({
  firstName: 'Alice',
  mood: 'excited',
});
```

To re-run [lifecycle hooks](lifecycle.md) during a snapshot restore (useful for
rehydration or undo), pass `{ recreate: true }`. The instance steps through:

1. Aborts the previous `onCreate` signal.
2. Fires all registered cleanups.
3. Runs `onDestroy`.
4. Applies the snapshot.
5. Runs `onCreate` fresh.

```ts
bob.$setSnapshot(savedState, { recreate: true });
```

## Nesting

Scope definitions support nested plain objects. Reactive fields can appear at
any depth:

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    job: {
      title: value<string>(),
      company: value<string>(),
    },
  },
  {
    label: ({ scope }) =>
      `${scope.firstName.use()}, ${scope.job.title.use()} at ${scope.job.company.use()}`,
  },
);
```

Nested objects appear as frozen objects on the instance. You access nested
fields the same way:

```ts
const bob = person.create({
  firstName: 'Bob',
  job: { title: 'Engineer', company: 'Acme' },
});

bob.job.title.get(); // 'Engineer'
bob.job.title.set('Senior Engineer');
bob.job.company.get(); // 'Acme'
```

Nesting is purely organizational. It does not create separate scopes or separate
lifecycle boundaries. All fields belong to the same instance and the same
reactive graph. For cross-scope composition (sharing state between independent
scopes), use [valueRef](refs.md) instead.

Nested objects also appear in [change hooks](change-hooks.md). You can check
`changesByScope.has(scope.job)` to see if any field nested under `job` changed.

## Plain data

Any entry in the field layer that is not a reactive primitive and not a plain
nested object is treated as static readonly data. It travels with the instance
but does not participate in reactivity:

```ts
const board = valueScope({
  boardId: value<string>(),
  schemaVersion: 1,
  defaultConfig: { theme: 'dark', locale: 'en' },
});

const inst = board.create({ boardId: 'a' });
inst.schemaVersion; // 1
inst.defaultConfig; // { theme: 'dark', locale: 'en' } — frozen
```

Static data is included in snapshots as-is.

## Non-reactive state with valuePlain

For data that needs `.get()` and `.set()` but should not trigger re-renders or
re-derivations, use `valuePlain()`:

```ts
import { valuePlain } from 'valuse';

const board = valueScope({
  boardId: value<string>(),
  metadata: valuePlain({ createdBy: '' }),
  config: valuePlain({ theme: 'dark' }, { readonly: true }),
});

const inst = board.create({ boardId: 'a' });
inst.metadata.get(); // { createdBy: '' }
inst.metadata.set({ createdBy: 'alice' });
inst.config.set({ theme: 'light' }); // throws — readonly
```

This is useful for bookkeeping state that changes frequently but should not
cause cascading updates.

## Undeclared properties

When working with external data that has more properties than your scope
declares (API responses, rich text nodes), enable `allowUndeclaredProperties` to
preserve the extras:

```ts
const node = valueScope(
  {
    id: value<string>(),
    type: value<string>(),
    isHighlighted: value(false),
  },
  { allowUndeclaredProperties: true },
);

const nodes = node.createMap();
nodes.set('n1', richTextNode);
// id, type, isHighlighted — reactive
// text, children, bold, italic — preserved as plain data
```

Undeclared properties are stored as non-reactive passthrough data. They appear
in snapshots and survive `$setSnapshot()` round-trips, but do not trigger
subscriptions or derivations.

## Type inference

`valueScope()` infers the full instance type from the definition. TypeScript
knows the exact type of every field:

```ts
const person = valueScope(
  {
    name: value<string>(),
    age: value(30),
  },
  { greeting: ({ scope }) => `Hello, ${scope.name.use()}` },
);

const bob = person.create({ name: 'Bob' });
// bob.name    → FieldValue<string | undefined>
// bob.age     → FieldValue<number>
// bob.greeting → FieldDerived<string>
```

The `ScopeInstance<Def>` type maps each definition entry to its instance
wrapper. `ValueInputOf<Def>` extracts the valid input keys for `.create()` and
`$setSnapshot()`. `SnapshotOf<Def>` is the plain-object type returned by
`$getSnapshot()`.

These utility types are exported for use in your own generic code:

```ts
import type { ScopeInstance, ValueInputOf, SnapshotOf } from 'valuse';

function savePerson(snapshot: SnapshotOf<typeof personDef>) { ... }
```
