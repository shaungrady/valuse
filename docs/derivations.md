# Derivations

Derivations are functions in a scope definition that compute values from other
fields. They are the reactive glue that keeps derived state in sync
automatically. When a dependency changes, the derivation re-runs and its
subscribers are notified.

For async derivations (fetching data, WebSockets, polling), see
[Async Derivations](async-derivations.md).

## Table of contents

- [Basic derivations](#basic-derivations)
- [Tracked vs untracked reads](#tracked-vs-untracked-reads)
- [The scope context](#the-scope-context)
- [Depending on other derivations](#depending-on-other-derivations)
- [Derivations over collections](#derivations-over-collections)
- [Derivations across groups](#derivations-across-groups)
- [Constant derivations](#constant-derivations)
- [Manual recompute](#manual-recompute)
- [React integration](#react-integration)

---

## Basic derivations

A derivation is any non-async function in the scope definition. It receives a
context object with a `scope` property for reading other fields:

```ts
const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
});

const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
bob.fullName.get(); // 'Bob Jones'

bob.firstName.set('Robert');
bob.fullName.get(); // 'Robert Jones'
```

Derivations are read-only. They have `.get()`, `.use()`, `.subscribe()`, and
`.recompute()`, but no `.set()`.

## Tracked vs untracked reads

Inside a derivation, each field on the scope context has two read methods:

| Method   | Behavior                                                    |
| -------- | ----------------------------------------------------------- |
| `.use()` | **Tracked read.** The derivation re-runs when this changes. |
| `.get()` | **Untracked read.** Current value, no dependency created.   |

```ts
const scope = valueScope({
  query: value(''),
  locale: value('en'),

  results: ({ scope }) => search(scope.query.use(), scope.locale.get()),
  //                                       ^^^^                  ^^^^
  //                              tracked — re-runs       untracked — reads once
});
```

When `query` changes, `results` re-runs. When `locale` changes, `results` does
not re-run (but if something else triggers a re-run, it will read the current
`locale`).

This distinction matters for performance. Track the dependencies that should
trigger recomputation, and use untracked reads for values you only need at
computation time.

## The scope context

The derivation function receives `{ scope }` where `scope` mirrors the instance
tree structure. Every reactive field and nested group is accessible:

```ts
const order = valueScope({
  items: valueArray<{ price: number; qty: number }>(),
  taxRate: value(0.08),

  subtotal: ({ scope }) =>
    scope.items.use().reduce((sum, item) => sum + item.price * item.qty, 0),

  total: ({ scope }) => {
    const sub = scope.subtotal.use();
    const tax = scope.taxRate.use();
    return sub * (1 + tax);
  },
});
```

The scope context is built once per instance and reused across all derivation
runs. It is a lightweight proxy, not a copy of the instance. Derivations can
also read through [refs](refs.md#reactivity-through-refs); reactivity flows
across scope boundaries seamlessly.

## Depending on other derivations

Derivations can depend on other derivations. The dependency graph is resolved
automatically:

```ts
const person = valueScope({
  first: value<string>(),
  last: value<string>(),

  full: ({ scope }) => `${scope.first.use()} ${scope.last.use()}`,
  greeting: ({ scope }) => `Hello, ${scope.full.use()}!`,
  initials: ({ scope }) => {
    const name = scope.full.use();
    return name
      .split(' ')
      .map((w) => w[0])
      .join('');
  },
});
```

When `first` changes:

1. `full` recomputes (depends on `first`)
2. `greeting` and `initials` recompute (depend on `full`)

Circular dependencies are not allowed. If derivation A uses derivation B and
derivation B uses derivation A, you will get an infinite loop. Structure your
derivations as a DAG (directed acyclic graph).

## Derivations over collections

Derivations work with all collection types. Use `.use()` on the collection to
track the whole collection, or `.use()` on individual elements if the collection
supports it:

```ts
const dashboard = valueScope({
  scores: valueMap<string, number>(),
  tags: valueSet<string>(),
  items: valueArray<number>(),

  average: ({ scope }) => {
    const values = [...scope.scores.use().values()];
    return values.reduce((a, b) => a + b, 0) / (values.length || 1);
  },

  tagCount: ({ scope }) => scope.tags.use().size,

  total: ({ scope }) => scope.items.use().reduce((sum, n) => sum + n, 0),
});
```

Any change to the collection (adding, removing, or updating entries) triggers
re-computation of derivations that called `.use()` on it.

## Derivations across groups

Derivations can read from any field in the scope, regardless of nesting depth:

```ts
const employee = valueScope({
  name: value<string>(),
  job: {
    title: value<string>(),
    salary: value(0),
  },
  summary: ({ scope }) =>
    `${scope.name.use()} — ${scope.job.title.use()} ($${scope.job.salary.use()})`,
});
```

The scope context mirrors the definition structure, so nested groups are
accessed through dot-path navigation on the scope object.

## Constant derivations

A derivation with zero `.use()` calls is a constant. It runs exactly once during
instance creation and never recomputes:

```ts
const config = valueScope({
  apiUrl: value('https://api.example.com'),
  headers: ({ scope }) => ({
    Authorization: `Bearer ${scope.apiUrl.get()}`, // untracked
    'Content-Type': 'application/json',
  }),
});
```

Constants are useful for computed configuration that depends on initial values
but should not change. If you later need it to update, switch `.get()` to
`.use()`.

## Manual recompute

Call `.recompute()` on any derivation to force a re-run, even if no tracked
dependencies changed. This is useful for derivations that use only `.get()`
(untracked reads) or that depend on external state:

```ts
bob.fullName.recompute(); // re-run this one derivation
bob.$recompute(); // re-run all derivations on the instance
```

Recomputation follows the same rules as automatic recomputation. If the
recomputed value is the same as the current value, subscribers are not notified.
For async derivations, `.recompute()` aborts the current run and starts fresh;
see [Async Derivations](async-derivations.md#error-handling).

## React integration

Derivations support `.use()` in React components, just like values. The
difference is that derivations return a single-element tuple (no setter):

```tsx
function Greeting({ person }) {
  const [greeting] = person.greeting.use();
  return <h1>{greeting}</h1>;
}
```

The component re-renders only when the derivation's output changes. If multiple
upstream values change but the derived result stays the same, there is no
re-render.

For async derivations with loading states, see
[Async Derivations — React integration](async-derivations.md#react-integration).
