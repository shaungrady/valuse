# ValUse

_Another_ state library? Yes, but a different kind. State libraries make you
choose: one big store (Zustand) or scattered atoms (Jotai). ValUse gives you
**scopes**: structured, reactive models with typed fields, derived state, and
lifecycle hooks built in, so your state mirrors how your data actually works
instead of how your framework wants it. Creating independent instances doesn't
require factory wrappers or providers.

**Let's compare:** [Overview](examples/comparison.md) |
[Zustand](examples/compare-zustand.md) | [Jotai](examples/compare-jotai.md) |
[MobX](examples/compare-mobx.md) | [Valtio](examples/compare-valtio.md) |
[React Context](examples/compare-react-context.md)

What can you build with it?

- [Another todo list](examples/todo-app.md), because the world needed one more
- A [form wizard](examples/form-wizard.md) with validation, dynamic fields, and
  cross-step state
- A [real-time stock ticker](examples/stock-ticker.md) with WebSocket feeds (GME
  to the moon)
- A [kanban board](examples/kanban-board.md) with drag-and-drop between columns
- A [command-palette search](examples/search-palette.md) with cascading async
  derivations, in-derivation debounce via `deferBy()`, and Enter-to-`flush()`
- A [Next.js search-params sync](examples/search-params.md) that hydrates from
  the URL and writes back via `onChange`
- [Middleware](examples/middleware.md) for logging, persistence, undo/redo

## Table of contents

- [Getting Started](#getting-started)
- [Reactive Values](#reactive-values)
  - [Collections](#collections)
  - [Transforms](#transforms)
  - [Custom comparison](#custom-comparison)
  - [Pipeline ordering](#pipeline-ordering)
  - [Batching](#batching)
- [Scopes](#scopes)
  - [Creating instances](#creating-instances)
  - [Field access](#field-access)
  - [Instance methods](#instance-methods)
  - [Nesting](#nesting)
  - [Derivations](#derivations)
  - [Plain data in scopes](#plain-data-in-scopes)
  - [Undeclared properties](#undeclared-properties)
- [Reacting to Changes](#reacting-to-changes)
  - [Per-field subscribe](#per-field-subscribe)
  - [Whole-scope subscribe](#whole-scope-subscribe)
  - [onChange](#onchange)
  - [beforeChange](#beforechange)
- [Scaling Up](#scaling-up)
  - [ScopeMap: keyed collections](#scopemap-keyed-collections)
  - [valueRef: scope composition](#valueref-scope-composition)
  - [Extending scopes](#extending-scopes)
  - [Async derivations](#async-derivations-advanced-patterns)
  - [Lifecycle hooks and signals](#lifecycle-hooks-and-signals)
  - [Factories](#factories)
  - [Schema validation](#schema-validation)
  - [Shipped middleware](#shipped-middleware)
- [Power Tools](#power-tools)
  - [Factory pipes](#factory-pipes)
  - [Type-changing pipes](#type-changing-pipes)
  - [Manual recompute](#manual-recompute)
  - [Type guards](#type-guards)
- [API Reference](#api-reference)
  - [Primitives](#primitives)
  - [Field types](#field-types)
  - [Value methods](#value-methods)
  - [valueArray methods](#valuearray-methods)
  - [Scope definition](#scope-definition)
  - [Instance fields](#instance-fields)
  - [Instance $ methods](#instance--methods)
  - [ScopeMap methods](#scopemap-methods)
  - [Scope config](#scope-config)
  - [Derivation context](#derivation-context)
  - [Type guards](#type-guards-1)
  - [Import paths](#import-paths)

---

## Getting Started

```sh
npm install valuse
```

```ts
import { value, valueScope } from 'valuse';

const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
  },
  {
    fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
  },
);

const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
bob.firstName.get(); // 'Bob'
bob.firstName.set('Robert');
bob.fullName.get(); // 'Robert Jones'
```

`valueScope()` takes one or more **layers**: fields first, then zero or more
derivation layers, then an optional config layer. The layered shape lets
TypeScript fully infer `scope` inside every derivation without a manual type
annotation. It also makes the dependency order visible at the call site and
makes circular derivations structurally impossible.

In React, import the side-effect bridge once anywhere in your app. It wires up
`useSyncExternalStore` so `.use()` hooks re-render on change:

```tsx
import 'valuse/react';

function PersonName({ person }) {
  const [firstName, setFirstName] = person.firstName.use();
  return (
    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
  );
}
```

---

## Reactive Values

A `value` wraps a piece of state with read, write, and subscription, plus
optional transforms and custom equality. Every other reactive type in ValUse
(`valueArray`, `valueSet`, `valueMap`, schema-validated values, scopes) builds
on the same core surface.

> **Deep dive:** [docs/reactive-values.md](docs/reactive-values.md)

```ts
import { value } from 'valuse';

const name = value<string>('Alice');
const count = value<number>(0);
```

Read, write, and subscribe. No framework required:

```ts
name.get(); // 'Alice'
name.set('Bob');
name.set((prev) => prev.toUpperCase()); // callback form
name.subscribe((v) => console.log(v)); // logs on every change
```

In React, `.use()` returns the current value and re-renders on change:

```tsx
const [currentName, setName] = name.use();
```

### Collections

> **Deep dive:**
> [docs/reactive-values.md#collections](docs/reactive-values.md#collections)

Reactive versions of Array, Set, and Map. Same core interface: `.get()`,
`.set()`, `.use()`, `.subscribe()`.

```ts
import { valueArray, valueSet, valueMap } from 'valuse';

const names = valueArray<string>();
names.set(['Alice', 'Bob']);
names.push('Charlie');
names.get(); // ['Alice', 'Bob', 'Charlie'] — frozen

const tags = valueSet<string>(['admin', 'active']);
tags.add('editor');
tags.delete('admin');
tags.has('editor'); // true

const scores = valueMap<string, number>([
  ['alice', 95],
  ['bob', 82],
]);
scores.get('alice'); // 95
scores.delete('bob');
```

`valueMap` supports per-key subscriptions in React:

```tsx
const [aliceScore, setAlice] = scores.use('alice'); // only re-renders when alice changes
const keys = scores.useKeys(); // only re-renders when keys change
```

`valueArray` supports per-index subscriptions:

```tsx
const [first, setFirst] = names.use(0); // only re-renders when index 0 changes
```

### Transforms

> **Deep dive:** [docs/pipes.md](docs/pipes.md)

Chain `.pipe()` to transform values on every `.set()`. Pipes run in order before
the value is stored:

```ts
const email = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase());
```

Pipes can change the type. `set()` accepts the input type, `get()` returns the
output type:

```ts
const count = value<string>('0').pipe((v) => parseInt(v));

count.set('42'); // accepts string
count.get(); // returns number — 42
```

`valueArray` supports per-element transforms with `pipeElement()`:

```ts
const names = valueArray<string>().pipeElement((s) => s.trim().toLowerCase());

names.push(' Hello '); // subscribers see 'hello'
```

### Custom comparison

By default, values notify subscribers on identity change (`===`). Override with
`.compareUsing()`:

```ts
const user = value<User>({ id: 1, name: 'Alice' }).compareUsing(
  (a, b) => a.id === b.id,
);
```

`valueArray` has `compareElementsUsing()` for per-element comparison:

```ts
const users = valueArray<User>().compareElementsUsing((a, b) => a.id === b.id);
```

### Pipeline ordering

When a value has both pipes and a custom comparator, the order is:

1. **set()**: raw input enters.
2. **pipe chain**: transforms run left to right.
3. **compareUsing()**: compared against current value.
4. **write**: if different, subscribers are notified.

This means comparison runs on the _post-pipe_ value, not the raw input.

### Batching

Group multiple writes so subscribers fire once:

```ts
import { batchSets } from 'valuse';

batchSets(() => {
  name.set('Bob');
  count.set(42);
});
// Subscribers notified once, not twice
```

---

## Scopes

A scope bundles related state into a reusable template. Call `.create()` to
produce as many independent instances as you need; each owns its own signals,
its own derivations, and its own lifecycle.

A scope definition can mix:

- **Reactive fields:** [`value()`](docs/reactive-values.md),
  [collections](docs/reactive-values.md#collections) (`valueArray()`,
  `valueSet()`, `valueMap()`), [`valueSchema()`](docs/schema-validation.md) for
  schema-validated values, and
  [`valuePlain()`](docs/scopes.md#non-reactive-state-with-valueplain) for
  non-reactive bookkeeping.
- **Derivations**, [sync](docs/derivations.md) or
  [async](docs/async-derivations.md), that read other fields and recompute when
  their dependencies change.
- **[Nested objects](docs/scopes.md#nesting)** in the field layer, so you can
  write `scope.job.title` without creating a separate scope. A nested object is
  just a plain object whose entries follow the same field-layer rules.
- **Refs to other scopes** via [`valueRef()`](docs/refs.md), so reactivity and
  lifecycle flow across template boundaries (shared globally, or per-instance
  via a factory).
- **[Lifecycle hooks](docs/lifecycle.md)** in the
  [config layer](docs/scopes.md#config-layer): `onCreate`, `onUsed`, `onUnused`,
  `onDestroy`, plus [`beforeChange` / `onChange`](docs/change-hooks.md) for side
  effects and
  [`validate`](docs/schema-validation.md#cross-field-validation-with-validate)
  for cross-field rules.

Scopes also compose:
[`.extendValues()` and `.extendConfig()`](docs/extending.md) layer extra values,
derivations, and hooks onto an existing template, which makes middleware just a
function from scope to scope.

Fields are accessed as properties on the instance, each with `.get()`, `.set()`,
and `.use()`. Derivations have the same surface minus `.set()`.

> **Deep dive:** [docs/scopes.md](docs/scopes.md) |
> [docs/derivations.md](docs/derivations.md)

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    mood: value<string>('happy'),
    hobbies: valueSet<string>(),
  },
  {
    fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
  },
);
```

### Creating instances

```ts
const bob = person.create({
  firstName: 'Bob',
  lastName: 'Jones',
  // mood defaults to 'happy'
});

const empty = person.create(); // all undefined or defaults
```

### Field access

Each reactive field (`value()`, `valueArray()`, `valueSet()`, `valueMap()`,
`valueSchema()`, `valueRef()`) exposes `.get()`, `.set()`, `.use()`, and
`.subscribe()`. Derivations have the same except `.set()`:

```ts
bob.firstName.get(); // 'Bob'
bob.firstName.set('Robert');
bob.firstName.set((prev) => prev.toUpperCase()); // callback form

bob.hobbies.add('climbing');
bob.hobbies.get(); // Set { 'climbing' }

bob.fullName.get(); // 'Robert Jones'
// bob.fullName.set() — doesn't exist, derivations are read-only
```

In React:

```tsx
const [firstName, setFirstName] = bob.firstName.use();
const [fullName] = bob.fullName.use(); // derivation — no setter
```

### Instance methods

Instance-level methods use a `$` prefix to separate them from field names:

```ts
bob.$get(); // resolved values, scope refs stay live
bob.$getSnapshot(); // plain data — recursively resolved
bob.$setSnapshot({ firstName: 'Alice', lastName: 'Smith' });
bob.$use(); // React hook — re-renders on any change
bob.$subscribe(fn); // whole-scope subscribe
bob.$recompute(); // re-run all derivations
bob.$destroy(); // tear down instance
```

`$getSnapshot()` resolves everything recursively to plain data, including across
scope ref boundaries. `$get()` stops at scope refs, leaving them as live
instances.

`$setSnapshot()` accepts a nested partial. Only reactive fields are written:

```ts
bob.$setSnapshot({
  job: { title: 'CTO' }, // updates job.title, leaves job.company alone
});
```

To re-run [lifecycle hooks](docs/lifecycle.md) during a snapshot restore, pass
`{ recreate: true }`. The instance steps through:

1. Aborts the previous `onCreate` signal.
2. Fires all registered cleanups.
3. Runs `onDestroy`.
4. Applies the snapshot.
5. Runs `onCreate` fresh.

```ts
bob.$setSnapshot(savedState, { recreate: true });
```

### Nesting

Scope definitions support [nesting](docs/scopes.md#nesting). Reactive `value()`
nodes can appear at any depth, with plain data as static readonly leaves:

```ts
const person = valueScope(
  {
    firstName: value<string>(),

    schemaVersion: 1, // plain data — readonly, not reactive

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

const bob = person.create({
  firstName: 'Bob',
  job: { title: 'Engineer', company: 'Acme' },
});

bob.job.title.get(); // 'Engineer'
bob.job.title.set('Senior Engineer');
bob.schemaVersion; // 1 — just a value, no .get()
```

For cross-scope composition (sharing state between independent scopes), use
[`valueRef`](docs/refs.md) instead of nesting.

### Derivations

> **Deep dive:** [docs/derivations.md](docs/derivations.md)

Derivations are functions that compute values from other fields. They receive a
`scope` context for reading state:

```ts
const scope = valueScope(
  {
    query: value<string>(''),
    locale: value<string>('en'),
  },
  {
    // .use() — tracked. Re-runs when query changes.
    // .get() — untracked. Reads locale without re-running when it changes.
    results: ({ scope }) => search(scope.query.use(), scope.locale.get()),
  },
);
```

- **`.use()`**: tracked read. The derivation re-runs when this value changes.
- **`.get()`**: untracked read. Current value, no dependency.

A derivation with zero `.use()` calls is a constant; it runs once and never
recomputes. Call `.recompute()` on any derivation to manually trigger a re-run.

#### Async derivations

When a derivation is `async`, ValUse automatically manages abort, status
tracking, and cleanup:

```ts
const user = valueScope(
  { userId: value<string>() },
  {
    profile: async ({ scope, signal }) => {
      const id = scope.userId.use();
      if (!id) return undefined;
      const res = await fetch(`/api/users/${id}`, { signal });
      return res.json();
    },
  },
);

const bob = user.create({ userId: 'bob' });
```

When `userId` changes, the previous fetch is aborted via `signal` and a new one
starts. `.use()` works anywhere in async derivations, before or after `await`.
Dependencies are tracked eagerly; changes trigger an immediate abort and re-run.

Async derivations have an `AsyncState` for status tracking:

```tsx
const [profile, profileState] = bob.profile.useAsync();

if (profileState.isPending) return <Spinner />;
if (profileState.isError) return <Error error={profileState.error} />;
return <Profile data={profile} />;
```

`.use()` returns `[T | undefined]` (just the value, no status). Use
`.useAsync()` when you need the state alongside it.

Sync derivations can depend on async ones without knowing they're async.
`.use()` returns `T | undefined`; no promises, no `await`:

```ts
const person = valueScope(
  { userId: value<string>() },
  {
    profile: async ({ scope, signal }) => {
      const res = await fetch(`/api/users/${scope.userId.use()}`, { signal });
      return res.json();
    },
  },
  {
    // Sync — just sees User | undefined. Recomputes when profile resolves.
    greeting: ({ scope }) => {
      const profile = scope.profile.use();
      return profile ? `Hello, ${profile.name}!` : 'Hello, friend!';
    },
  },
);
```

If you later change `profile` from sync to async (or vice versa), `greeting`
doesn't change at all.

You can seed an async derivation with cached data at creation time for
stale-while-revalidate behavior:

```ts
const bob = person.create({
  userId: 'bob',
  profile: cachedProfile, // available immediately via .get(), replaced when fetch resolves
});
```

> **Deep dive:** [docs/async-derivations.md](docs/async-derivations.md)

### Plain data in scopes

Any entry in the field layer that isn't a reactive primitive or a nested object
is treated as static readonly data. It travels with the instance but doesn't
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

For non-reactive data that you still need to read and write, use `valuePlain()`.
It has `.get()` and `.set()` but is invisible to the reactive graph. Changes
won't trigger re-renders or re-derivations:

```ts
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

### Undeclared properties

When working with external data that has more properties than your scope
declares (e.g., rich text nodes, API responses), use `allowUndeclaredProperties`
to preserve the extras as plain, non-reactive data:

```ts
const baseNode = valueScope(
  {
    id: value<string>(),
    type: value<string>(),
    isHighlighted: value<boolean>(false),
  },
  { allowUndeclaredProperties: true },
);

const nodes = baseNode.createMap();
nodes.set('node-1', slateNode);
// id, type, isHighlighted — reactive
// text, children, bold, italic — preserved but not reactive
```

---

## Reacting to Changes

There are two ways to wire side effects to state changes:
[subscribe](docs/change-hooks.md#per-field-subscribe) to a specific field or a
whole instance for a value-as-it-changes stream, or use the config layer's
[`beforeChange`](docs/change-hooks.md#beforechange) /
[`onChange`](docs/change-hooks.md#onchange) hooks to intercept and respond to
writes with full structured change metadata. `beforeChange` runs synchronously
before each write and can `prevent()` it; `onChange` runs after a batch of
writes settles and tells you which fields and which subscopes changed.

> **Deep dive:** [docs/change-hooks.md](docs/change-hooks.md)

### Per-field subscribe

Each reactive field on a scope instance has `.subscribe()`:

```ts
bob.firstName.subscribe((value, previousValue) => {
  console.log(`${previousValue} → ${value}`);
});
```

### Whole-scope subscribe

```ts
bob.$subscribe(() => {
  console.log('something changed:', bob.$getSnapshot());
});
```

### onChange

Fires after mutations. Batched: multiple synchronous sets produce one call. Uses
`changesByScope` to check which parts of the tree changed:

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    lastUpdated: value<number>(0),
    job: {
      title: value<string>(),
    },
  },
  {
    onChange: ({ scope, changes, changesByScope }) => {
      if (changesByScope.has(scope.job)) {
        console.log('job changed');
      }
      scope.lastUpdated.set(Date.now());
    },
  },
);
```

### beforeChange

Fires synchronously before each value is written. Use `prevent()` to block the
write. Derivations never see prevented values.

Unlike `onChange`, `beforeChange` is **per-write, not batched**: it fires once
for each `.set()` call with `changes.size === 1`. `batchSets` defers downstream
effect propagation but does not collapse `beforeChange` invocations; each write
is independently veto-able.

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    job: {
      title: value<string>(),
    },
  },
  {
    beforeChange: ({ scope, changes, prevent }) => {
      // `changes` always holds exactly one change here.
      const [change] = changes;

      // Prevent a specific field
      if (change.path === 'job.title') prevent(change);

      // Prevent everything under a nested subtree
      if (change.to === '') prevent(scope.job);

      // Prevent based on the change itself
      if (change.to === null) prevent(change);
    },
  },
);
```

---

## Scaling Up

Beyond a single scope instance, ValUse covers the patterns that usually come
next: keyed collections of the same shape ([`ScopeMap`](docs/scope-map.md)),
composition across independent scopes ([`valueRef`](docs/refs.md)), derived
templates and middleware
([`.extendValues()` / `.extendConfig()`](docs/extending.md)),
[long-running async work](docs/async-derivations.md#long-running-derivations),
[lifecycle setup and teardown](docs/lifecycle.md),
[schema validation](docs/schema-validation.md), and a small kit of shipped
middleware ([devtools](docs/devtools.md), [persistence](docs/persistence.md),
[undo/redo](docs/history.md)).

### ScopeMap: keyed collections

> **Deep dive:** [docs/scope-map.md](docs/scope-map.md)

When you need many instances of the same scope (rows, list items, entries),
`.createMap()` supports several hydration styles:

```ts
// Empty collection
const people = person.createMap();

// From an array, keyed by field name
const people = person.createMap(apiResponse, 'id');

// From an array, keyed by callback
const people = person.createMap(apiResponse, (item) => item.id);

// From a Map
const people = person.createMap(
  new Map([
    ['alice', { firstName: 'Alice', lastName: 'Smith' }],
    ['bob', { firstName: 'Bob', lastName: 'Jones' }],
  ]),
);
```

Add, update, and remove entries after creation:

```ts
people.set('alice', { firstName: 'Alice', lastName: 'Smith' });
people.delete('alice'); // fires onDestroy for that instance
people.has('alice'); // boolean
people.keys(); // string[]
people.size; // number of entries
people.clear(); // remove all, fires onDestroy for each
```

Access fields directly on the instance:

```ts
const alice = people.get('alice');
alice.firstName.get(); // 'Alice'
alice.firstName.set('Alicia');
alice.$destroy();
```

In React:

```tsx
function PersonRow({ person }) {
  const [firstName, setFirstName] = person.firstName.use();
  return (
    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
  );
}

function PeopleTable({ people }) {
  const keys = people.useKeys();
  return keys.map((id) => <PersonRow key={id} person={people.get(id)} />);
}
```

### valueRef: scope composition

> **Deep dive:** [docs/refs.md](docs/refs.md)

Use `valueRef()` to bring external reactive state into a scope. Refs are shared
across all instances. They point to the same source, not a copy:

```ts
import { valueRef } from 'valuse';

const globalTags = valueSet<string>(['admin', 'root']);

const person = valueScope({
  name: value<string>(),
  tags: valueRef(globalTags),
});
```

Per-instance refs with factories. Each instance gets its own nested scope:

```ts
const column = valueScope({ id: value<string>(), name: value<string>() });

const board = valueScope(
  {
    boardId: value<string>(),
    columns: valueRef(() => column.createMap()),
  },
  {
    columnCount: ({ scope }) => scope.columns.use().size,
  },
);
```

Reactivity flows through refs. A derivation that reads a ref's fields via
`use()` will re-run when those fields change, just like any other dependency.

Lifecycle is [transitive](docs/refs.md#transitive-lifecycle) too. When a scope
gets its first subscriber (triggering [`onUsed`](#lifecycle-hooks-and-signals)),
all scopes it references via `valueRef()` also become "used," activating their
`onUsed` hooks and async derivations. When the last subscriber detaches,
referenced scopes are notified as well.

### Extending scopes

> **Deep dive:** [docs/extending.md](docs/extending.md)

`.extendValues()` adds new state and derivations; `.extendConfig()` attaches
lifecycle hooks. Both return new templates that include everything from the
original:

```ts
const trackedPerson = person
  .extendValues({ lastUpdated: value<number>(Date.now()) })
  .extendConfig({
    onChange: ({ scope }) => {
      scope.lastUpdated.set(Date.now());
    },
  });
```

Remove fields with `undefined`:

```ts
const simplified = person.extendValues({
  job: undefined, // removes the nested job object. TypeScript catches broken refs.
});
```

Since `.extendValues()` and `.extendConfig()` take a scope and return a scope,
middleware is just a function:

```ts
const withTracking = (scope) =>
  scope.extendValues({ lastUpdated: value<number>(Date.now()) }).extendConfig({
    onChange: ({ scope }) => scope.lastUpdated.set(Date.now()),
  });

const withSoftDelete = (scope) =>
  scope.extendValues({ deleted: value<boolean>(false) });

const fullPerson = withSoftDelete(withTracking(person));
```

### Async derivations: advanced patterns

> **Deep dive:** [docs/async-derivations.md](docs/async-derivations.md)

#### Status tracking

Every async derivation has an `AsyncState<T>`:

```ts
interface AsyncState<T> {
  value: T | undefined;
  hasValue: boolean;
  status: 'unset' | 'setting' | 'set' | 'error';
  error: unknown;
  isPending: boolean; // setting && !hasValue — "first load, show a spinner"
  isUpdating: boolean; // setting && hasValue — new value computing, keep current on screen
  isError: boolean; // status === 'error'
}
```

- Starts `'unset'`, no value yet
- While running: `'setting'` (preserves previous value)
- On resolve: `'set'`
- On reject: `'error'` (preserves previous value)

#### Intermediate values with set()

Push values before the final `return`. Useful for optimistic updates, streaming,
and progress reporting:

```ts
results: async ({ scope, set, signal }) => {
  const q = scope.query.use();
  const cached = cache.get(q);
  if (cached) set(cached);            // show cached immediately
  const res = await fetch(`/api/search?q=${q}`, { signal });
  return res.json();                   // replace with fresh data
},
```

#### Cleanup

Register cleanup functions with `onCleanup()`. They run when the derivation
re-runs or when the instance is destroyed:

```ts
messages: async ({ scope, set, onCleanup }) => {
  const ws = new WebSocket(`/rooms/${scope.roomId.use()}`);
  onCleanup(() => ws.close());
  ws.onmessage = (e) => set(JSON.parse(e.data));
},
```

#### Dependency tracking

`.use()` works anywhere in async derivations, before or after `await`.
Dependencies are tracked eagerly via per-call subscriptions. If a tracked dep
changes mid-flight, the abort signal fires immediately and the derivation
re-runs:

```ts
profile: async ({ scope, signal }) => {
  const id = scope.userId.use();
  const data = await fetch(`/api/${id}`, { signal });

  if (data.needsAuth) {
    const token = scope.authToken.use();   // works after await
    return fetchWithAuth(data.url, token, { signal });
  }
  return data;
},
```

#### Long-running derivations

Since `set()` can push values at any point during execution, putting it inside a
loop creates a long-running process. This is a natural fit for polling,
WebSocket streams, or any open-ended data source:

```ts
import { asyncDelay } from 'valuse/utils';

const stockPrice = valueScope(
  { symbol: value<string>() },
  {
    price: async ({ scope, set, signal }) => {
      const sym = scope.symbol.use();
      if (!sym) return;
      while (!signal.aborted) {
        const price = await fetchPrice(sym);
        if (!signal.aborted) set(price);
        await asyncDelay({ ms: 1000, signal });
      }
      // Loop runs until signal aborts; values come from set()
    },
  },
);
```

When `symbol` changes, the previous loop is aborted and a new one starts. When
the instance is destroyed, it's aborted automatically.

### Lifecycle hooks and signals

> **Deep dive:** [docs/lifecycle.md](docs/lifecycle.md)

| Hook        | When it fires                            |
| ----------- | ---------------------------------------- |
| `onCreate`  | Once, when instance is created           |
| `onDestroy` | When instance is destroyed               |
| `onUsed`    | Subscriber count transitions from 0 to 1 |
| `onUnused`  | Subscriber count transitions from 1 to 0 |

These four are the instance-lifetime hooks. The change-related hooks
(`beforeChange`, `onChange`) and `validate` live in the same config layer; see
the [Scope config](#scope-config) reference for the full list.

`onCreate` and `onUsed` provide `signal` and `onCleanup` for automatic teardown.
`onCreate` also receives `input`, the data passed to `.create()`, for cases
where you need to react to it before subscribers attach:

```ts
const scope = valueScope(
  {
    width: value<number>(window.innerWidth),
  },
  {
    onCreate: ({ scope, signal, onCleanup }) => {
      // signal — pass to APIs that accept it
      window.addEventListener(
        'resize',
        () => scope.width.set(window.innerWidth),
        { signal },
      );

      // onCleanup — for everything else
      const interval = setInterval(() => {
        /* ... */
      }, 1000);
      onCleanup(() => clearInterval(interval));
    },
  },
);
```

`onCreate`'s signal aborts when the instance is destroyed. `onUsed`'s signal
aborts when the last subscriber detaches, and is recreated fresh on the next
attach.

Destroy is a terminal state. After `destroy()` / `$destroy()`:

- Reads still return the last value.
- Writes are silently dropped, along with any deferred work that crosses the
  boundary (debounced flushes, async resolutions).
- Subscribers stop firing.
- A second call is a no-op.

### Factories

Since a [scope](docs/scopes.md) is just a function return value, you can
parameterize them:

```ts
const createCounter = (initial: number, step: number) =>
  valueScope(
    { count: value(initial) },
    {
      increment:
        ({ scope }) =>
        () =>
          scope.count.set((c) => c + step),
      decrement:
        ({ scope }) =>
        () =>
          scope.count.set((c) => c - step),
    },
  );

const byOnes = createCounter(0, 1);
const byTens = createCounter(100, 10);
```

### Schema validation

> **Deep dive:** [docs/schema-validation.md](docs/schema-validation.md)

`valueSchema` pairs a reactive value with a
[Standard Schema](https://standardschema.dev)-compliant validator. The value
holds whatever was last set; validation state is metadata available alongside
it, like `AsyncState` for async derivations. Works with ArkType, Zod, Valibot,
or any library that implements Standard Schema.

```ts
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { valueSchema, valueScope } from 'valuse';

const Email = type('string.email');
const Password = type('8 <= string');

const signupForm = valueScope(
  {
    email: valueSchema(Email, ''),
    password: valueSchema(Password, ''),
    confirm: valueSchema(Password, ''),
  },
  {
    validate: ({ scope }) => {
      const issues: StandardSchemaV1.Issue[] = [];
      if (scope.password.use() !== scope.confirm.use()) {
        issues.push({ message: 'Passwords must match', path: ['confirm'] });
      }
      return issues;
    },
  },
);
```

Types flow from the schema. No manual type annotations needed:

```ts
const instance = signupForm.create();

instance.email.set('not-an-email');
instance.email.get(); // 'not-an-email' (whatever was last set)
instance.email.getValidation();
// { isValid: false, value: 'not-an-email', issues: [...] }

instance.email.set('alice@example.com');
instance.email.get(); // 'alice@example.com'
instance.email.getValidation();
// { isValid: true, value: 'alice@example.com', issues: [] }
```

`ValidationState<In, Out>` is a discriminated union on `isValid`: when valid,
`validation.value` is the schema's parsed `Out`; when invalid, it's the raw `In`
that was last set. For pure validators where input and output coincide this is
invisible, but for parsing morphs (`type('string.numeric.parse')`) it gives you
a clean way to read the parsed value after an `isValid` guard. `.get()` always
returns the input type.

In React, `.useValidation()` gives you the value, setter, and validation state
in one call. The first two slots match `.use()` so you can swap them without
rewiring. Fields show both per-field schema errors and cross-field errors from
`validate` (routed via `path`):

```tsx
function EmailField() {
  const form = useForm();
  const [email, setEmail, validation] = form.email.useValidation();

  return (
    <div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      {!validation.isValid && (
        <span className="error">{validation.issues[0]?.message}</span>
      )}
    </div>
  );
}

function SubmitButton() {
  const form = useForm();
  const isValid = form.$useIsValid();

  return (
    <button type="submit" aria-disabled={!isValid}>
      Submit
    </button>
  );
}
```

`$getIsValid()` / `$useIsValid()` returns a boolean gate; `$getValidation()` /
`$useValidation()` returns `{ isValid, issues }` with scope-relative paths so
you can render errors anywhere. Both pairs accept `{ deep: true }` to walk
subscopes transitively, prefixing nested paths with the ref field name (and
ScopeMap entry key) so a child's `path: ['email']` surfaces at the parent as
`path: ['account', 'email']`.

`validate` lives in the config layer alongside `onCreate` and the other
lifecycle hooks, but it isn't an event hook. It is a reactive derivation that
returns an `Issue[]`, re-evaluating whenever a `.use()`'d dependency changes.

It composes with `.extendConfig()`: both base and extension `validate` rules
run, and issues are concatenated.

Async schemas are rejected at the type level; pair a sync schema with an async
derivation if you need to check something like username availability.

### Shipped middleware

ValUse ships three batteries-included middleware wrappers for the most common
scope patterns, plus storage adapters for `withPersistence` and standalone
`connectDevtools` / `connectMapDevtools` helpers. Everything lives at
`valuse/middleware`:

| Middleware        | Purpose                                            | Deep dive                                  |
| ----------------- | -------------------------------------------------- | ------------------------------------------ |
| `withDevtools`    | Redux DevTools integration — timeline, time travel | [docs/devtools.md](docs/devtools.md)       |
| `withPersistence` | Sync state to localStorage, IndexedDB, or custom   | [docs/persistence.md](docs/persistence.md) |
| `withHistory`     | Undo/redo with bounded depth and batched typing    | [docs/history.md](docs/history.md)         |

Each one wraps a scope template and returns a new template with the behavior
layered on:

```ts
import { valueScope, value } from 'valuse';
import {
  withDevtools,
  withPersistence,
  withHistory,
  localStorageAdapter,
} from 'valuse/middleware';

const prefs = valueScope({
  theme: value<'light' | 'dark'>('light'),
  fontSize: value<number>(14),
});

// Compose freely — each middleware takes and returns a ScopeTemplate.
const final = withDevtools(
  withPersistence(withHistory(prefs), {
    key: 'prefs',
    adapter: localStorageAdapter,
  }),
  { name: 'prefs' },
);

const instance = final.create();
instance.fontSize.set(18);
instance.$undo(); // history
// also: persisted to localStorage, and visible in Redux DevTools
```

For standalone values and `ScopeMap`s that don't flow through `.extendConfig()`,
the devtools package also exports `connectDevtools(value, …)` and
`connectMapDevtools(map, …)`; see [docs/devtools.md](docs/devtools.md).

---

## Power Tools

A handful of advanced primitives for when you need more than the common
patterns: [factory pipes](docs/pipes.md#factory-pipes) for stateful transforms
like debounce and throttle,
[type-changing pipes](docs/pipes.md#type-changing-pipes) that let a value's
input and output types diverge, manual
[`.recompute()`](docs/derivations.md#manual-recompute) for derivations that only
do untracked reads, and [runtime type guards](#type-guards) for middleware that
operates on unknown fields.

### Factory pipes

> **Deep dive:** [docs/pipes.md](docs/pipes.md)

For stateful, deferred transforms like debounce and throttle, `.pipe()` accepts
a factory object:

```ts
import { pipeDebounce, pipeThrottle, pipeScan } from 'valuse/utils';

const search = value<string>('')
  .pipe((v) => v.trim())
  .pipe(pipeDebounce(300));

const scroll = value<number>(0).pipe(pipeThrottle(16));

const history = value<string>('').pipe(pipeScan((acc, v) => [...acc, v], []));
// set('a') → ['a'], set('b') → ['a', 'b']
```

Available factory pipes: `pipeDebounce`, `pipeThrottle`, `pipeBatch`,
`pipeFilter`, `pipeScan`, `pipeUnique`. Also available: `pipeEnum` (sync
transform that narrows values to an allowed set, falling back to the first
element for invalid input).

### Type-changing pipes

Pipes can change the type. `set()` accepts the input type, `get()` returns the
output type:

```ts
const flag = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.length) // string → number
  .pipe((v) => v > 0); // number → boolean

flag.set('hello'); // accepts string
flag.get(); // returns boolean — true
```

### Manual recompute

Trigger re-runs of derivations that use only `.get()` (untracked reads):

```ts
bob.fullName.recompute(); // single derivation
bob.$recompute(); // all derivations
```

### Type guards

Runtime type narrowing for middleware and generic utilities:

```ts
import { isValue, isSchema, isPlain, isComputed, isScope } from 'valuse';

isValue(bob.firstName); // true, has .get(), .set(), .use()
isSchema(bob.email); // true, has .getValidation(), .useValidation()
isPlain(bob.metadata); // true, has .get(), .set(), no .use()
isComputed(bob.fullName); // true, has .get(), .use(), no .set()
isScope(bob); // true, scope instance
```

> **Note:** a schema-validated field is also a value field, so
> `isValue(bob.email)` returns `true` for a `valueSchema` slot. When narrowing,
> check the more specific predicate first:
>
> ```ts
> if (isSchema(field)) { ...validation-aware path... }
> else if (isValue(field)) { ...plain reactive value... }
> ```

---

## API Reference

### Primitives

| Export                   | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `value<T>()`             | Reactive value, starts as `undefined`                |
| `value<T>(default)`      | Reactive value with default                          |
| `valueSet<T>()`          | Reactive Set                                         |
| `valueMap<K, V>()`       | Reactive Map                                         |
| `valueArray<T>()`        | Reactive Array with index subscriptions              |
| `valuePlain<T>(default)` | Non-reactive get/set container                       |
| `valueSchema(s, def)`    | Schema-validated reactive value (Standard Schema)    |
| `valueRef(source)`       | Reference to external reactive state (shared)        |
| `valueRef(() => source)` | Per-instance ref — factory called on each `create()` |
| `batchSets(fn)`          | Group writes — subscribers fire once                 |

### Field types

The runtime types of fields on a scope instance. Use these to annotate component
props that accept a single field:

```ts
function EmailField({ field }: { field: FieldValueSchema<string, string> }) {
  const [email, setEmail, validation] = field.useValidation();
  // ...
}
```

| Type                        | Produced by               |
| --------------------------- | ------------------------- |
| `FieldValue<In, Out>`       | `value()`                 |
| `FieldValueSchema<In, Out>` | `valueSchema()`           |
| `FieldValueArray<T>`        | `valueArray()`            |
| `FieldValueSet<T>`          | `valueSet()`              |
| `FieldValueMap<K, V>`       | `valueMap()`              |
| `FieldValuePlain<T>`        | `valuePlain()`            |
| `FieldValueRef<T>`          | `valueRef()`              |
| `FieldDerived<T>`           | sync derivation function  |
| `FieldAsyncDerived<T>`      | async derivation function |

For `FieldValue<In, Out>` and `FieldValueSchema<In, Out>`, both type parameters
equal `T` in the common case; they only diverge once a `.pipe()` or schema morph
changes the stored type.

The naming rule is mechanical for factory-produced fields: `Field` + PascalCase
of the factory name. Function-form derivations don't have a factory, so they use
`FieldDerived` and `FieldAsyncDerived`.

### Value methods

| Method              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `.get()`            | Read the current value                               |
| `.set(value)`       | Write a new value (callback form: `prev => next`)    |
| `.use()`            | React hook — `[value, setter]`, re-renders on change |
| `.subscribe(fn)`    | Listen for changes, returns unsubscribe              |
| `.pipe(fn)`         | Transform on set, chainable, can change type         |
| `.pipe(factory)`    | Factory pipe for stateful transforms                 |
| `.flush()`          | Async — cascade flush of pipe chain (Promise<void>)  |
| `.compareUsing(fn)` | Custom equality check                                |
| `.destroy()`        | Tear down all subscriptions                          |

### valueArray methods

| Method                       | Description                                |
| ---------------------------- | ------------------------------------------ |
| `.get()`                     | Read the full array (frozen)               |
| `.get(index)`                | Read element by index (negative supported) |
| `.length`                    | Number of elements                         |
| `.set(array)` / `.set(i, v)` | Replace whole array or by index            |
| `.push()` / `.pop()`         | Append / remove last                       |
| `.unshift()` / `.shift()`    | Prepend / remove first                     |
| `.splice(start, count, ...)` | Remove and/or insert at position           |
| `.filter(fn)` / `.map(fn)`   | Transform array                            |
| `.sort(fn?)` / `.reverse()`  | Sort / reverse                             |
| `.swap(i, j)`                | Swap two indices                           |
| `.use()`                     | React hook — whole array                   |
| `.use(index)`                | React hook — single index (negative ok)    |
| `.pipeElement(fn)`           | Per-element transform, can change type     |
| `.compareElementsUsing(fn)`  | Per-element equality check                 |
| `.subscribe(fn)`             | Listen for changes                         |
| `.destroy()`                 | Tear down all subscriptions                |

### Scope definition

| Method                                       | Description                                       |
| -------------------------------------------- | ------------------------------------------------- |
| `valueScope(fields)`                         | Define a scope template (fields only)             |
| `valueScope(fields, ...derivations)`         | Add up to 11 derivation layers, in dep order      |
| `valueScope(fields, ...derivations, config)` | Plus an optional config layer (lifecycle hooks)   |
| `scope.create(data)`                         | Create a single instance                          |
| `scope.createMap()`                          | Create an empty keyed collection                  |
| `scope.createMap(data, 'field')`             | Create collection from array, keyed by field name |
| `scope.createMap(data, fn)`                  | Create collection from array, keyed by callback   |
| `scope.createMap(map)`                       | Create collection from a `Map` or `[key, data][]` |
| `scope.extendValues(valuesOrDerivs)`         | Derive a new scope (values-layer OR deriv-layer)  |
| `scope.extendValues(values, ...derivations)` | Variadic layered extension (no config slot)       |
| `scope.extendConfig(config)`                 | Attach lifecycle hooks; doesn't change definition |

### Instance fields

| Method             | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `.get()`           | Read value                                                             |
| `.set(value)`      | Write value (callback: `prev => next`). Values only.                   |
| `.use()`           | React hook — `[value, setter]` or `[value]` for derivations            |
| `.subscribe(fn)`   | Per-field change listener — `fn(value, previousValue)`                 |
| `.flush()`         | Async — expedite deferred work, await settle. Values & async derivs.   |
| `.recompute()`     | Re-run this derivation. Derived fields only.                           |
| `.useAsync()`      | React hook — `[value, AsyncState<T>]`. Async derived fields only.      |
| `.getAsync()`      | Read `AsyncState<T>`. Async derived fields only.                       |
| `.useValidation()` | React hook — `[value, setter, ValidationState<In, Out>]`. Schema only. |
| `.getValidation()` | Read `ValidationState<In, Out>`. Schema fields only.                   |

### Instance $ methods

| Method                           | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| `.$get()`                        | Resolved values, scope refs stay live                         |
| `.$getSnapshot()`                | Plain data — everything recursively resolved                  |
| `.$setSnapshot(d)`               | Partial write — reactive fields only                          |
| `.$setSnapshot(d, { recreate })` | Write + re-run onDestroy then onCreate                        |
| `.$use()`                        | React hook — `[snapshot, setter]`, re-renders on any change   |
| `.$subscribe(fn)`                | Whole-scope change listener                                   |
| `.$destroy()`                    | Tear down, fire onDestroy, detach all subscribers             |
| `.$recompute()`                  | Re-run all derivations                                        |
| `.$flush()`                      | Async — expedite pending deferred work, layer-ordered cascade |
| `.$getIsValid(opts?)`            | True when all schema fields and `validate` pass               |
| `.$useIsValid(opts?)`            | React hook — re-renders when overall validity changes         |
| `.$getValidation(opts?)`         | `{ isValid, issues }` with scope-relative paths               |
| `.$useValidation(opts?)`         | React hook — re-renders when issue list changes               |

### ScopeMap methods

| Method                                 | Description                             |
| -------------------------------------- | --------------------------------------- |
| `.get(key)`                            | Get the instance for a key              |
| `.set(key, data)`                      | Add or update an instance               |
| `.delete(key)`                         | Remove and destroy an instance          |
| `.keys()` / `.values()` / `.entries()` | List keys, instances, or both           |
| `.has(key)`                            | Check if key exists                     |
| `.size`                                | Number of entries                       |
| `.useKeys()`                           | React hook — re-renders on add/remove   |
| `.subscribe(fn)`                       | Listen for key-list changes             |
| `.clear()`                             | Remove all, fires `$destroy()` for each |

### Scope config

| Option         | Description                                                           |
| -------------- | --------------------------------------------------------------------- |
| `onCreate`     | `{ scope, input, signal, onCleanup }` — once on create                |
| `beforeChange` | `{ scope, changes, changesByScope, prevent }` — sync, pre-write       |
| `onChange`     | `{ scope, changes, changesByScope }` — batched, post-write            |
| `onUsed`       | `{ scope, signal, onCleanup }` — first subscriber attaches            |
| `onUnused`     | `{ scope }` — last subscriber detaches                                |
| `onDestroy`    | `{ scope }` — instance destroyed                                      |
| `validate`     | `{ scope }` — reactive derivation, returns `StandardSchemaV1.Issue[]` |

### Derivation context

| Property        | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `scope`         | Root scope — access fields via `scope.field.use()` / `.get()` |
| `signal`        | _(Async)_ AbortSignal — aborted on dep change or destroy      |
| `set(value)`    | _(Async)_ Push intermediate values                            |
| `onCleanup(fn)` | _(Async)_ Register cleanup for re-run or destroy              |
| `deferBy(ms)`   | _(Async)_ Abortable + flushable sleep                         |
| `previousValue` | _(Async)_ The last resolved value, or `undefined`             |

### Type guards

| Export          | Description                                   |
| --------------- | --------------------------------------------- |
| `isValue(x)`    | True if `x` is a reactive value field         |
| `isSchema(x)`   | True if `x` is a schema-validated value field |
| `isPlain(x)`    | True if `x` is a non-reactive plain field     |
| `isComputed(x)` | True if `x` is a derived value field          |
| `isScope(x)`    | True if `x` is a scope instance               |

### Import paths

| Path                | Contents                                                                  |
| ------------------- | ------------------------------------------------------------------------- |
| `valuse`            | Core — `value`, `valueScope`, `valueSet`, `valueMap`, `valueArray`, types |
| `valuse/react`      | React bridge — `import 'valuse/react'` to enable `.use()` hooks           |
| `valuse/utils`      | Pipe factories, async derivation helpers, and signal primitives           |
| `valuse/middleware` | Shipped middleware — `withDevtools`, `withPersistence`, `withHistory`     |
