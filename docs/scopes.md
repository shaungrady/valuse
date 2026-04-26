# Scopes

A scope bundles related reactive state, derivations, and lifecycle hooks into a
reusable template. You define the shape once with `valueScope()`, then call
`.create()` to produce independent instances. Each instance has its own signals,
its own derivations, and its own lifecycle.

## Table of contents

- [Defining a scope](#defining-a-scope)
- [Creating instances](#creating-instances)
- [Field access](#field-access)
- [Instance methods](#instance-methods)
- [Snapshots](#snapshots)
- [Nesting](#nesting)
- [Plain data](#plain-data)
- [Non-reactive state with valuePlain](#non-reactive-state-with-valueplain)
- [Undeclared properties](#undeclared-properties)
- [Type inference](#type-inference)

---

## Defining a scope

A scope definition is a plain object where each key maps to one of:

| Entry type                    | What it becomes on the instance                                  |
| ----------------------------- | ---------------------------------------------------------------- |
| `value<T>()`                  | Reactive field with `.get()`, `.set()`, `.use()`                 |
| `valueSet<T>()`               | Reactive Set field                                               |
| `valueMap<K,V>()`             | Reactive Map field                                               |
| `valueArray<T>()`             | Reactive Array field                                             |
| [`valueRef(source)`](refs.md) | Read-only reference to external state                            |
| Sync function                 | [Derived](derivations.md) (computed) field                       |
| Async function                | [Async derived](async-derivations.md) field with status tracking |
| Plain object                  | Nested group (recurses)                                          |
| Anything else                 | Static readonly data                                             |

```ts
import { value, valueScope, valueSet } from 'valuse';

const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  mood: value('happy'),
  hobbies: valueSet<string>(),
  fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
});
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
derivation seeds, and nested groups accept input. Derivation keys are excluded
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
| `$destroy()`     | Tear down the instance (see [Lifecycle](lifecycle.md))          |

```ts
bob.$subscribe(() => {
  console.log('something changed');
});

bob.$destroy(); // runs onDestroy hook, aborts async work, cleans up
```

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
rehydration or undo), pass `{ recreate: true }`. This fires `onDestroy`, applies
the snapshot, then fires `onCreate` fresh:

```ts
bob.$setSnapshot(savedState, { recreate: true });
```

## Nesting

Scope definitions support nested plain objects. Reactive fields can appear at
any depth:

```ts
const person = valueScope({
  firstName: value<string>(),
  job: {
    title: value<string>(),
    company: value<string>(),
  },
  label: ({ scope }) =>
    `${scope.firstName.use()}, ${scope.job.title.use()} at ${scope.job.company.use()}`,
});
```

Groups are frozen objects on the instance. You access nested fields the same
way:

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

Groups also appear in [change hooks](change-hooks.md). You can check
`changesByScope.has(scope.job)` to see if any field in the `job` group changed.

## Plain data

Any entry that is not a `value()`, not a function, and not a plain object group
is treated as static readonly data. It travels with the instance but does not
participate in reactivity:

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
const person = valueScope({
  name: value<string>(),
  age: value(30),
  greeting: ({ scope }) => `Hello, ${scope.name.use()}`,
});

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
