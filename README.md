# ValUse

_Another_ state library? Yes, but a different kind. State libraries make you
choose: one big store (Zustand) or scattered atoms (Jotai). ValUse gives you
**scopes** — structured, reactive models with typed fields, derived state, and
lifecycle hooks built in, so your state mirrors how your data actually works
instead of how your framework wants it. And creating independent instances
doesn't require factory wrappers or providers.

**Let's compare:** [Zustand](examples/compare-zustand.md) |
[Jotai](examples/compare-jotai.md) | [MobX](examples/compare-mobx.md) |
[Valtio](examples/compare-valtio.md) |
[React Context](examples/compare-react-context.md)

So what kind of stuff does ValUse make easy?

- [Another todo list](examples/todo-app.md), because the world needed one more
- A [form wizard](examples/form-wizard.md) with validation, dynamic fields, and
  cross-step state
- A [real-time stock ticker](examples/stock-ticker.md) with WebSocket feeds (GME
  to the moon)
- A [kanban board](examples/kanban-board.md) with drag-and-drop between columns
- [Middleware](examples/middleware.md) for logging, persistence, undo/redo

Just want to see code? **[Quickstart](QUICKSTART.md)**

## Table of contents

- [Values](#values) — reactive primitives with transforms and custom comparison
- [Collections](#collections) — reactive Set and Map
- [Scopes](#scopes) — structured models with typed fields and derivations
  - [Derivations](#derivations) — use/get, previousValue, identity comparison
- [Plain values](#plain-values) — non-reactive data in scopes
- [Keyed collections of scopes](#keyed-collections-of-scopes) — many instances
  of the same scope
- [Lifecycle](#lifecycle) — onInit, beforeChange, onChange, onUsed/onUnused,
  onDestroy
- [Refs](#refs) — share reactive state across scopes, with per-instance
  factories
- [Extending scopes](#extending-scopes) — derive new scopes, reusable middleware
- [Async derivations](#async-derivations) — fetch, stream, poll — all reactive
- [Factories](#factories) — parameterized scope templates
- [Batching](#batching)
- [API reference](#api-reference)

## Values

The building block. A `value` is a single piece of reactive state.

```ts
import { value } from 'valuse';

const name = value<string>('Alice');
const count = value<number>(0);
```

Read, write, and subscribe — no framework required:

```ts
name.get(); // 'Alice'
name.set('Bob');
name.set((prev) => prev.toUpperCase()); // callback form
name.subscribe((v) => console.log(v)); // logs on every change
```

In React, `.use()` returns a `[value, setter]` tuple that subscribes and
re-renders on change:

```tsx
const [currentName, setName] = name.use();
```

All `.subscribe()` calls return an unsubscribe function. `.destroy()` tears down
all active subscriptions at once:

```ts
const unsub = name.subscribe((v) => console.log(v));
unsub(); // stop this listener
name.destroy(); // stop all listeners
```

### Transforms

Chain `.pipe()` to normalize values on every `set`. Transforms run in order
before the value is stored:

```ts
const email = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase());
```

Since pipes are just functions, extract and reuse them:

```ts
const trim = (v: string) => v.trim();
const lower = (v: string) => v.toLowerCase();
const clamp = (min: number, max: number) => (v: number) =>
  Math.max(min, Math.min(max, v));

const email = value<string>('').pipe(trim).pipe(lower);
const age = value<number>(0).pipe(clamp(0, 150));
```

### Custom comparison

By default, values notify subscribers on identity change (`===`). Override with
`.compareUsing()`:

```ts
const user = value<User>({ id: 1, name: 'Alice' }).compareUsing(
  (a, b) => a.id === b.id,
);
```

`.pipe()` and `.compareUsing()` work on all value types — `value`, `valueSet`,
and `valueMap`.

## Collections

Reactive versions of the JS data structures you already know. Same interface as
`value` — `.get()`, `.set()`, `.subscribe()`, `.use()`, `.pipe()`,
`.compareUsing()`, `.destroy()`.

### valueSet

```ts
import { valueSet } from 'valuse';

const tags = valueSet<string>(['admin', 'active']);

tags.get(); // Set { 'admin', 'active' }
tags.has('admin'); // true
tags.size; // 2

// Mutation callbacks receive a draft — write mutations, get a new immutable Set
tags.set((draft) => draft.add('editor'));
tags.set((draft) => draft.delete('admin'));

// Convenience methods
tags.add('editor');
tags.delete('admin');
tags.clear();
```

In React:

```tsx
const [current, set] = tags.use();
set((t) => t.add('editor'));
```

### valueMap

```ts
import { valueMap } from 'valuse';

const scores = valueMap<string, number>([
  ['alice', 95],
  ['bob', 82],
]);

scores.get(); // Map { 'alice' => 95, 'bob' => 82 }
scores.get('alice'); // 95
scores.has('alice'); // true
scores.size; // 2
scores.keys(); // ['alice', 'bob']

scores.set((draft) => draft.set('charlie', 90));
scores.delete('bob');
```

In React, subscribe to the whole map or a single key:

```tsx
const [all, setAll] = scores.use(); // whole map
const [aliceScore, setAlice] = scores.use('alice'); // only re-renders when alice changes
const keys = scores.useKeys(); // only re-renders when keys change
```

## Scopes

A `valueScope` bundles related state and derivations into a reusable template.

```ts
import { value, valueScope } from 'valuse';

const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  role: value<string>('viewer'),

  fullName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
});
```

Values called without an argument start as `undefined`. Values called with an
argument start with that default. Derivations receive a context object — see
below for the full API.

### Creating instances

```ts
const bob = person.create({
  firstName: 'Bob',
  lastName: 'Jones',
  // role defaults to 'viewer'
});

const partial = person.create({ role: 'admin' }); // firstName, lastName are undefined
const empty = person.create(); // all undefined or defaults
```

### Reading and writing

```ts
bob.get('firstName'); // 'Bob'
bob.get('fullName'); // 'Bob Jones' — derivations work like any other field

bob.set('role', 'admin');
bob.set('role', (prev) => prev.toUpperCase()); // callback form
bob.set({ firstName: 'Robert', lastName: 'Smith' }); // bulk — omitted fields untouched
```

Only `value()` fields are settable. Derivations and refs are read-only — a
TypeScript error to `set`, silently ignored at runtime.

### Using in React

```tsx
// All fields — re-renders on any change
const [getPerson, setPerson] = bob.use();
getPerson('fullName'); // 'Bob Jones'
setPerson('role', 'admin');

// Single field — only re-renders when that field changes
const [firstName, setFirstName] = bob.use('firstName');
const [fullName] = bob.use('fullName'); // derivation — no setter
```

### Snapshots

`getSnapshot()` returns a plain object of the entire scope state — values,
derivations, refs, and passthrough data. One-time read, not reactive:

```ts
bob.getSnapshot();
// { firstName: 'Bob', lastName: 'Jones', role: 'viewer', fullName: 'Bob Jones' }
```

`setSnapshot()` is a full replacement. Omitted keys reset to `undefined`:

```ts
bob.setSnapshot({ firstName: 'Alice', lastName: 'Smith', role: 'admin' });
bob.setSnapshot({ firstName: 'Charlie' });
bob.get('lastName'); // undefined — not 'Smith'
```

Use `setSnapshot(data, { rerunInit: true })` to re-fire `onInit` after
restoring.

### Subscribing outside React

```ts
bob.subscribe((get) => {
  console.log(get('fullName'));
});
```

Subscribe to a single field — only fires when that field changes:

```ts
bob.subscribe('email', (value, previousValue) => {
  console.log(`email: ${previousValue} → ${value}`);
});
```

Per-field subscribe works on ScopeMap too:

```ts
people.subscribe('alice', 'email', (value, previousValue) => {
  console.log(`alice's email: ${previousValue} → ${value}`);
});
```

### Derivations

Derivations are functions in a scope that compute values from other fields —
like `fullName` above. They receive a **context object** with tools for reading
state.

#### use() vs get() — tracked and untracked reads

The same naming convention runs through the entire library:

- **`use()`** — subscribes. In React, `instance.use("firstName")` re-renders
  when `firstName` changes. Inside a derivation, `use("firstName")` re-derives
  when `firstName` changes. Same idea, same name.
- **`get()`** — reads once, no subscription. `instance.get("firstName")` returns
  the current value without subscribing. Inside a derivation, `get("firstName")`
  reads the current value without tracking it as a dependency.

```ts
const scope = valueScope({
  query: value<string>(''),
  locale: value<string>('en'),

  // Re-runs when query changes, but NOT when locale changes.
  // locale is read once at compute time, not tracked.
  results: ({ use, get }) => search(use('query'), get('locale')),
});
```

Use `get()` when you need to read a value but don't want to re-derive when it
changes — configuration, one-time reads, or avoiding unnecessary recomputation.

A derivation with zero `use()` calls is a **constant** — it runs once and never
recomputes.

#### previousValue — referential stability

Every derivation receives `previousValue`, which is the value it returned on its
last computation (`undefined` on the first run). Use it to maintain referential
stability when you want to avoid unnecessary downstream updates:

```ts
const scope = valueScope({
  items: value<Item[]>([]),
  filter: value<string>(''),

  filtered: ({ use, previousValue }) => {
    const result = use('items').filter((i) => i.name.includes(use('filter')));
    // If the result is deeply equal to the last one, return the same reference
    if (previousValue && deepEqual(result, previousValue)) return previousValue;
    return result;
  },
});
```

Derivation returns are compared by identity (`===`). If a derivation returns the
same reference as before, downstream derivations and subscribers are not
notified.

#### The derivation context

| Property        | Type                       | Description                                                                |
| --------------- | -------------------------- | -------------------------------------------------------------------------- |
| `use(key)`      | `(key) => value`           | Read + track dependency. Derivation re-runs when this field changes.       |
| `get(key)`      | `(key) => value`           | Read without tracking. Current value only.                                 |
| `getAsync(key)` | `(key) => AsyncState<T>`   | Read the full async state (status, value, error) of any field.             |
| `previousValue` | `unknown`                  | The last value this derivation returned (`undefined` on first run).        |
| `signal`        | `AbortSignal`              | _(Async only)_ Aborted when deps change or instance is destroyed.          |
| `set(value)`    | `(value) => void`          | _(Async only)_ Push intermediate values (optimistic, streaming, progress). |
| `onCleanup(fn)` | `(fn: () => void) => void` | _(Async only)_ Register cleanup that runs on re-derivation or destroy.     |

The async-only properties (`signal`, `set`, `onCleanup`) are covered in
[Async derivations](#async-derivations).

## Plain values

Use `valuePlain()` to store non-reactive data in a scope. Plain values are
readable via `get()` but invisible to the reactive graph — they won't trigger
re-renders or re-derivations:

```ts
import { value, valuePlain, valueScope } from 'valuse';

const board = valueScope({
  boardId: value<string>(),
  config: valuePlain({ theme: 'dark', locale: 'en' }, { readonly: true }),
  metadata: valuePlain({ createdBy: '' }),
});

const inst = board.create();
inst.get('config'); // { theme: 'dark', locale: 'en' }
inst.get('metadata'); // { createdBy: '' }
inst.set('metadata', { createdBy: 'alice' }); // ok — writable
inst.set('config', {}); // throws — readonly
inst.use('config'); // throws — plain values can't be use()'d
```

Plain values appear in `getSnapshot()` and can be overridden at `create()` time.
The `readonly` option prevents `set()` after creation (both a TypeScript error
and a runtime throw).

Use `valuePlain` when you need data that travels with the scope but doesn't
participate in reactivity — configuration, external references, metadata.

## Keyed collections of scopes

When you need many instances of the same scope — rows in a table, items in a
list, entries in a form — use `.createMap()`:

```ts
// Empty collection
const people = person.createMap();

// From an array — string shorthand for the key field
const people = person.createMap(apiResponse, 'id');

// From an array — callback for computed keys
const people = person.createMap(apiResponse, (item) => item.id);

// From a Map
const people = person.createMap(
  new Map([
    ['alice', { firstName: 'Alice', lastName: 'Smith' }],
    ['bob', { firstName: 'Bob', lastName: 'Jones' }],
  ]),
);
```

Add, update, and remove entries:

```ts
people.set('alice', { firstName: 'Alice', lastName: 'Smith' });
people.delete('alice'); // fires onDestroy for that instance
people.size; // number of entries
people.keys(); // string[]
people.has('alice'); // boolean
people.clear(); // remove all, fires onDestroy for each
```

In React, each row is its own reactive boundary:

```tsx
type People = ReturnType<typeof person.createMap>;

function PersonRow({ id, people }: { id: string; people: People }) {
  const [getPerson, setPerson] = people.use(id);

  return (
    <input
      value={getPerson('firstName')}
      onChange={(e) => setPerson('firstName', e.target.value)}
    />
  );
}

function PeopleTable({ people }: { people: People }) {
  const keys = people.useKeys();
  return keys.map((id) => <PersonRow key={id} id={id} people={people} />);
}
```

Per-field subscriptions work here too:

```ts
const [firstName, setFirstName] = people.use('bob', 'firstName');
const [fullName] = people.use('bob', 'fullName'); // derivation, read-only
```

## Lifecycle

Scopes support lifecycle hooks via a config object as the second argument.

### onInit

Runs once when an instance is created. Receives `{ set, get, input }` — the raw
value passed to `create()` or `map.set()`:

```ts
const formField = valueScope(
  {
    value: value<string>(),
    initialValue: value<string>(),
    isTouched: value<boolean>(),
    isDirty: ({ use }) => use('value') !== use('initialValue'),
  },
  {
    onInit: ({ set, get }) => {
      set('initialValue', get('value'));
      set('isTouched', false);
    },
  },
);
```

### onChange

Fires after mutations. **Batched by default** — multiple synchronous sets
produce one `onChange` call on the next microtask. Multiple changes to the same
field within a batch are collapsed — you see the original `from` and the final
`to`. Sets inside `onChange` do not re-trigger the hook.

Two forms — catch-all function or per-field object:

```ts
// Catch-all: receives all changes in one callback
const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    lastUpdated: value<number>(0),
  },
  {
    onChange: ({ changes, set, get, getSnapshot }) => {
      // changes is a Map<string, { key, from, to }>
      // changes.has('firstName'), changes.get('firstName')?.to, etc.
      set('lastUpdated', Date.now());
    },
  },
);
```

```ts
// Per-field: each handler only fires for its field
const formField = valueScope(
  {
    value: value<string>(),
    error: value<string | null>(null),
  },
  {
    onChange: {
      value: ({ to, set }) => {
        set('error', validate(to));
      },
    },
  },
);
```

Per-field handlers receive `{ from, to, get, set }` — no digging through a
changes map. Both forms can be mixed via `extend()` — the merge normalizes them
automatically.

### beforeChange

Fires **synchronously** before values are written. Use it to validate or prevent
changes — derivations never see prevented values.

Two forms, mirroring `onChange` — catch-all or per-field:

```ts
// Catch-all: prevent specific fields or all changes
const person = valueScope(
  {
    role: value<string>('viewer'),
    email: value<string>(),
    isAdmin: value<boolean>(false),
  },
  {
    beforeChange: ({ changes, prevent, get }) => {
      // Prevent non-admins from changing role
      if (changes.has('role') && !get('isAdmin')) prevent('role');
    },
  },
);
```

```ts
// Per-field: each handler decides for its own field
const person = valueScope(
  {
    email: value<string>(''),
    name: value<string>(''),
  },
  {
    beforeChange: {
      email: ({ to, prevent }) => {
        if (!to.includes('@')) prevent();
      },
    },
  },
);
```

`prevent()` with no arguments blocks all pending changes.
`prevent('email', 'role')` blocks specific fields — the rest go through
normally.

Values shown in `beforeChange` are **post-comparison** — the hook only fires
when a real change is about to occur (`===` check already passed). Prevented
changes never trigger `onChange`. Bulk `set({ ... })` batches all fields into
one `beforeChange` call so you can reason about them together.

### onUsed / onUnused

`onUsed` fires when the first subscriber starts watching. `onUnused` fires when
the last subscriber stops. Useful for lazy resources:

```ts
const analytics = valueScope(
  {
    sessionId: value<string>(),
  },
  {
    onUsed: ({ get }) => {
      track('session_start', { id: get('sessionId') });
    },
    onUnused: ({ get }) => {
      track('session_end', { id: get('sessionId') });
    },
  },
);
```

For producing derived values from async sources (fetch, WebSocket, polling),
[async derivations](#async-derivations) are usually a better fit — they handle
abort and cleanup automatically.

### onDestroy

Runs when an instance is removed from a collection or manually destroyed:

```ts
const chatRoom = valueScope(
  {
    roomId: value<string>(),
    ws: value<WebSocket | null>(null),
  },
  {
    onInit: ({ set, get }) => {
      set('ws', new WebSocket(`/rooms/${get('roomId')}`));
    },
    onDestroy: ({ get }) => {
      get('ws')?.close();
    },
  },
);

const rooms = chatRoom.createMap();
rooms.delete('room-42'); // onDestroy fires, websocket closes
```

### allowUndeclaredProperties

By default, properties not declared in the scope are silently dropped. Set
`allowUndeclaredProperties: true` to preserve them as plain, non-reactive data:

```ts
const baseNode = valueScope(
  {
    id: value<string>(),
    type: value<string>(),
    isHighlighted: value<boolean>(false),
  },
  { allowUndeclaredProperties: true },
);

// Slate node has { id, type, text, children, bold, italic, ... }
const nodes = baseNode.createMap();
nodes.set('node-1', slateNode);
// id, type, isHighlighted — reactive
// text, children, bold, italic — preserved but not reactive
```

## Refs

Use `valueRef()` to bring external reactive state into a scope. Refs are shared
across all instances — they point to the same source, not a copy:

```ts
import { value, valueRef, valueScope, valueSet } from 'valuse';

const globalSpecialTags = valueSet<string>(['admin', 'root']);

const person = valueScope({
  firstName: value<string>(),
  tags: valueSet<string>(),
  specialTags: valueRef(globalSpecialTags),

  hasSpecialTag: ({ use }) =>
    use('tags').some((t) => use('specialTags').has(t)),
});
```

### Nested scopes

Refs work with scope instances, giving you nested reactive access:

```ts
const address = valueScope({
  street: value<string>(),
  city: value('NYC'),
  full: ({ use }) => `${use('street')}, ${use('city')}`,
});
const sharedAddress = address.create({ street: '123 Main' });

const person = valueScope({
  name: value<string>(),
  address: valueRef(sharedAddress),
});
const bob = person.create({ name: 'Bob' });

bob.get('address').get('full'); // '123 Main, NYC'
bob.get('address').set('street', '456 Oak'); // mutates the shared instance
```

Signal tracking flows transitively — derivations that read through a ref
automatically react to changes in the referenced scope.

### Per-instance refs with factories

Pass a factory function to `valueRef()` to create a separate source for each
scope instance. This is how you nest scopes where each parent gets its own
children:

```ts
const column = valueScope({ id: value<string>(), name: value<string>() });

const board = valueScope({
  boardId: value<string>(),
  columns: valueRef(() => column.createMap()),

  columnCount: ({ use }) => use('columns').size,
});

const a = board.create({ boardId: 'a' });
const b = board.create({ boardId: 'b' });
// a and b each have their own independent column map
```

When a factory returns a `ScopeMap`, derivations using `use()` automatically
react to key additions and removals. In the example above, `columnCount`
re-derives whenever a column is added or removed.

`valueRef` also accepts a `ScopeMap` directly for shared collections:

```ts
const sharedColumns = column.createMap();

const board = valueScope({
  columns: valueRef(sharedColumns), // all board instances share this map
  columnCount: ({ use }) => use('columns').size,
});
```

### Transitive lifecycle

When a scope becomes "used" (its first subscriber attaches), all scope instances
it references via `valueRef()` also become "used" — triggering their `onUsed`
hooks and activating any async derivations. When the outer scope becomes
"unused" (last subscriber detaches), referenced scopes are unsubscribed too.

This means a stock price scope connected via `valueRef()` will automatically
start its data feed when the consuming scope gets its first subscriber, and stop
when the last one leaves — no manual wiring needed.

## Extending scopes

`.extend()` returns a new scope that includes everything from the original plus
new state, derivations, and lifecycle hooks. The original is untouched:

```ts
const trackedPerson = person.extend(
  {
    lastUpdated: value<number>(Date.now()),
    changeCount: value<number>(0),
  },
  {
    onChange: ({ changes, set }) => {
      set('lastUpdated', Date.now());
      set('changeCount', (prev) => prev + changes.size);
    },
  },
);
```

Extended scopes can promote passthrough properties into reactive values:

```ts
const paragraphNode = baseNode.extend({
  text: value<string>(''),
  wordCount: ({ use }) => use('text').split(/\s+/).filter(Boolean).length,
});

const imageNode = baseNode.extend({
  src: value<string>(),
  alt: value<string>(''),
  isLoading: value<boolean>(false),
});
```

### Reusable middleware

Since `.extend()` takes a scope and returns a scope, middleware is just a
function:

```ts
const withTracking = (scope) =>
  scope.extend(
    {
      lastUpdated: value<number>(Date.now()),
      changeCount: value<number>(0),
    },
    {
      onChange: ({ changes, set }) => {
        set('lastUpdated', Date.now());
        set('changeCount', (prev) => prev + changes.size);
      },
    },
  );

const withSoftDelete = (scope) =>
  scope.extend({
    deleted: value<boolean>(false),
    deletedAt: value<number | null>(null),
  });

// Compose
const fullPerson = withSoftDelete(withTracking(person));
```

## Async derivations

When a derivation is an `async` function, ValUse automatically manages its
lifecycle — abort on re-run, status tracking, intermediate values, and cleanup.

```ts
const scope = valueScope({
  userId: value<string>(),

  profile: async ({ use, signal }) => {
    const res = await fetch(`/api/users/${use('userId')}`, { signal });
    return res.json();
  },
});
```

When `userId` changes, the previous fetch is **aborted** via `signal` and a new
one starts. Downstream consumers just see `T | undefined` — no async contagion.

### Status tracking with AsyncState

Every async derivation has an `AsyncState<T>` that tracks its lifecycle:

```ts
interface AsyncState<T> {
  value: T | undefined; // The resolved value (or undefined if unset)
  hasValue: boolean; // Whether a value has ever been set
  status: 'unset' | 'setting' | 'set' | 'error';
  error: unknown;
}
```

Status transitions:

- Starts as `'unset'` — no value yet
- When the async function is running: `'setting'` (preserves previous value if
  any)
- When it resolves: `'set'`
- When it rejects: `'error'` (preserves previous value)

Read async state on instances with `getAsync(key)` or `useAsync(key)`:

```ts
const inst = scope.create({ userId: 'alice' });

inst.getAsync('profile');
// { value: undefined, hasValue: false, status: 'setting', error: undefined }

// ...after resolution:
// { value: { name: 'Alice', ... }, hasValue: true, status: 'set', error: undefined }
```

In React:

```tsx
const [profile, profileState] = inst.useAsync('profile');
// profile = the value (or undefined)
// profileState = full AsyncState

if (profileState.status === 'setting') return <Spinner />;
if (profileState.status === 'error')
  return <Error error={profileState.error} />;
return <Profile data={profile} />;
```

### Intermediate values with set()

Use `set()` inside async derivations to push values before the final `return`.
This enables optimistic updates, streaming, polling, and progress reporting:

```ts
const scope = valueScope({
  query: value<string>(),

  results: async ({ use, set, signal }) => {
    const q = use('query');

    // Optimistic: show cached results immediately
    const cached = cache.get(q);
    if (cached) set(cached);

    // Then fetch fresh data
    const res = await fetch(`/api/search?q=${q}`, { signal });
    return res.json(); // final value
  },
});
```

### Seeding with cached data

Pass a value for an async derivation key in `create()` to seed it with cached
data. The seed is available immediately via `get()` — stale-while-revalidate
with zero extra state:

```ts
const scope = valueScope({
  userId: value<string>(),
  profile: async ({ use, signal }) => {
    const res = await fetch(`/api/users/${use('userId')}`, { signal });
    return res.json();
  },
});

// Seed with cached data — available instantly, replaced when fetch resolves
const instance = scope.create({
  userId: 'alice',
  profile: cachedProfile,
});
instance.get('profile'); // cachedProfile — no waiting
```

### Cleanup

Register cleanup functions with `onCleanup()`. They run when the derivation
re-runs (deps changed) or when the instance is destroyed:

```ts
const scope = valueScope({
  roomId: value<string>(),

  messages: async ({ use, set, onCleanup }) => {
    const ws = new WebSocket(`/rooms/${use('roomId')}`);
    onCleanup(() => ws.close());

    ws.onmessage = (e) => set(JSON.parse(e.data));

    // Return undefined — value comes from set() via WebSocket
  },
});
```

### Dependency tracking in async

Dependencies are tracked during the **synchronous preamble** only — the part
before the first `await`. Any `use()` calls after an `await` are not tracked:

```ts
async ({ use, signal }) => {
  const id = use('userId'); // tracked — before await
  const data = await fetch(`/api/${id}`, { signal });
  const locale = use('locale'); // NOT tracked — after await
  return format(data, locale);
};
```

If you need to track a value but only use it after an `await`, read it before
the first `await`:

```ts
async ({ use, signal }) => {
  const id = use('userId'); // tracked
  const locale = use('locale'); // tracked — read before await
  const data = await fetch(`/api/${id}`, { signal });
  return format(data, locale);
};
```

### No async contagion

Sync derivations can depend on async derivations without knowing they're async.
`use("profile")` returns `T | undefined` regardless of whether `profile` is sync
or async — no promises, no `await`, no loading checks:

```ts
const scope = valueScope({
  userId: value<string>(),
  profile: async ({ use, signal }) => {
    const res = await fetch(`/api/users/${use('userId')}`, { signal });
    return res.json();
  },
  // Sync — just sees User | undefined. Recomputes when profile resolves.
  greeting: ({ use }) => {
    const p = use('profile');
    return p ? `Hello, ${p.name}!` : 'Loading...';
  },
});
```

If you later change `profile` from async to sync (or vice versa), `greeting`
doesn't change at all. When you _do_ need loading state, errors, or status
transitions, `useAsync("profile")` gives you the full `AsyncState` — but only
the consumers that care about those details opt in. See the
[comparison doc](examples/comparison.md#code-comparison) for how this differs
from other libraries, where async tends to spread through the entire dependency
chain.

### Async derivations vs manual lifecycle

The old way uses lifecycle hooks to manually manage a polling interval:

```ts
// Manual lifecycle — more boilerplate, harder to follow
const stockPrice = valueScope(
  {
    symbol: value<string>(),
    price: value<number>(0),
    interval: value<number | null>(null),
  },
  {
    onUsed: ({ set, get }) => {
      const id = setInterval(async () => {
        const p = await fetchPrice(get('symbol'));
        set('price', p);
      }, 1000);
      set('interval', id);
    },
    onUnused: ({ get }) => {
      clearInterval(get('interval'));
    },
  },
);
```

With async derivations, the same thing is declarative:

```ts
// Async derivation — self-contained, reactive, cancellable
const stockPrice = valueScope({
  symbol: value<string>(),

  price: async ({ use, set, signal, onCleanup }) => {
    const sym = use('symbol');
    const poll = async () => {
      while (!signal.aborted) {
        const p = await fetchPrice(sym);
        if (!signal.aborted) set(p);
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    poll();
    // No return — value comes from set()
  },
});
```

When `symbol` changes, the previous poll is aborted and a new one starts. When
the instance is destroyed, it's aborted automatically. No lifecycle hooks
needed. Now that you've seen both approaches, the manual `onUsed`/`onUnused`
pattern from the [lifecycle](#onused--onunused) section should feel like the
escape hatch it is — useful for side effects that don't produce a value, but
async derivations cover the common case.

## Factories

Since a scope is just a function return value, you can parameterize them:

```ts
import { type } from 'arktype';

const formField = (initialValue, schema) =>
  valueScope(
    {
      value: value(initialValue),
      initialValue: value(initialValue),
      isTouched: value<boolean>(),

      isDirty: ({ use }) => use('value') !== use('initialValue'),
      isValid: ({ use }) => schema.allows(use('value')),
      errors: ({ use }) => schema(use('value')).errors ?? [],
      error: ({ use }) =>
        use('isTouched') && !use('isValid') ? use('errors')[0]?.message : null,
    },
    {
      onInit: ({ set, get }) => {
        set('initialValue', get('value'));
        set('isTouched', false);
      },
    },
  );

const contactForm = valueScope({
  name: formField('', type('string > 0')),
  email: formField('', type('string.email')),
  age: formField(18, type('number.integer >= 18')),

  isValid: ({ use }) =>
    use('name').isValid && use('email').isValid && use('age').isValid,
  firstError: ({ use }) =>
    use('name').error ?? use('email').error ?? use('age').error,
});
```

## Batching

Use `batch()` to group multiple writes so subscribers fire once:

```ts
import { batch } from 'valuse';

batch(() => {
  name.set('Bob');
  count.set(42);
});
// Subscribers notified once, not twice
```

## API reference

### Primitives

| Export                      | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `value<T>()`                | Reactive value, starts as `undefined`                      |
| `value<T>(default)`         | Reactive value with default                                |
| `valuePlain<T>(value)`      | Non-reactive value in a scope (readable, not subscribable) |
| `valuePlain(v, {readonly})` | Non-reactive, read-only after creation                     |
| `valueRef(source)`          | Reference to external reactive state (shared, not copied)  |
| `valueRef(() => source)`    | Per-instance ref — factory called on each `create()`       |
| `value().pipe(fn)`          | Transform values on set, chainable                         |
| `value().compareUsing(fn)`  | Custom equality check for re-renders                       |
| `valueSet<T>()`             | Reactive Set (accepts `T[]` or `Set<T>`)                   |
| `valueMap<K, V>()`          | Reactive Map (accepts `[K, V][]` or `Map<K, V>`)           |
| `batch(fn)`                 | Group writes — subscribers fire once                       |

### Scopes

| Method                          | Description                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `valueScope({ ... })`           | Define a scope template                                            |
| `valueScope({ ... }, config)`   | Define a scope with lifecycle hooks                                |
| `scope.create(data)`            | Create a single instance                                           |
| `scope.createMap()`             | Create an empty keyed collection of instances                      |
| `scope.createMap(data, getKey)` | Create a collection from an array, keyed by field name or callback |
| `scope.createMap(mapData)`      | Create a collection from a `Map<string, data>`                     |
| `scope.extend({ ... })`         | Derive a new scope with additional state and derivations           |

### Instance methods

| Method                  | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `.get(key)`             | Read a single value, derivation, or ref                                 |
| `.set(key, value)`      | Set a single value field (callback form: `prev => next`)                |
| `.set({ ... })`         | Bulk set — each provided key is set, others untouched                   |
| `.getAsync(key)`        | Read `AsyncState<T>` for any field (sync fields return `status: 'set'`) |
| `.use()`\*              | `[getFoo, setFoo]` — subscribe to all fields                            |
| `.use(field)`\*         | `[value, setter]` or `[value]` for derivations                          |
| `.useAsync(field)`\*    | `[value, AsyncState]` — subscribe to async status                       |
| `.getSnapshot()`        | Plain object of full state (values, derivations, refs, passthrough)     |
| `.setSnapshot(data)`    | Full replace — omitted value keys reset to `undefined`                  |
| `.subscribe(fn)`        | Listen for changes to any field, returns unsubscribe function           |
| `.subscribe(field, fn)` | Listen for changes to a single field — `fn(value, previousValue)`       |
| `.destroy()`            | Tear down instance, fire `onDestroy`, detach all subscribers            |

### Value / ValueSet / ValueMap methods

| Method                 | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `.get()`               | Read the current value                            |
| `.set(value)`          | Write a new value (callback form: `prev => next`) |
| `.use()`\*             | `[value, setter]`                                 |
| `.subscribe(fn)`       | Listen for changes, returns unsubscribe function  |
| `.pipe(fn)`            | Transform values on set, chainable                |
| `.compareUsing(fn)`    | Custom equality check                             |
| `.destroy()`           | Tear down all subscriptions                       |
| `valueMap.use(key)`\*  | `[value, setter]` for a single key                |
| `valueMap.useKeys()`\* | Array of keys                                     |

### ScopeMap methods

| Method                       | Description                                       |
| ---------------------------- | ------------------------------------------------- |
| `.get(key)`                  | Get the instance for a key                        |
| `.set(key, data)`            | Add or update an instance                         |
| `.delete(key)`               | Remove and destroy an instance                    |
| `.keys()` / `.values()`      | List keys or instances                            |
| `.use(key)`\*                | `[getFoo, setFoo]` for that instance              |
| `.use(key, field)`\*         | `[value, setter]` or `[value]` for a single field |
| `.useKeys()`\*               | Array of keys, re-renders on add/remove           |
| `.subscribe(fn)`             | Listen for key-list changes                       |
| `.subscribe(key, field, fn)` | Listen for a single field on an instance          |
| `.clear()`                   | Remove all, fires `onDestroy` for each            |

\* React hook. Requires `import 'valuse/react'`. Subscribes and re-renders on
change.

### Scope config

| Option                      | Description                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `onInit`                    | Once, when created. Receives `{ set, get, input }`                                                                            |
| `beforeChange`              | Sync, before write. Function: `{ changes, prevent, get }`. Object: per-field `{ from, to, prevent, get }`. Can block changes  |
| `onChange`                  | Function form: `{ changes: Map<key, {key,from,to}>, set, get, getSnapshot }`. Object form: per-field `{ from, to, set, get }` |
| `onUsed`                    | When the first subscriber starts watching                                                                                     |
| `onUnused`                  | When the last subscriber stops watching                                                                                       |
| `onDestroy`                 | When an instance is removed or destroyed                                                                                      |
| `allowUndeclaredProperties` | Preserve unrecognized properties as plain non-reactive data (default: `false`)                                                |
