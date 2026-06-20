# ValUse

_Another_ state library? Yes, but a different kind. State libraries make you
choose: one big store (Zustand) or scattered atoms (Jotai). ValUse gives you
**scopes**: structured, reactive models with typed fields, derived state, and
lifecycle hooks built in, so your state mirrors how your data actually works
instead of how your framework wants it. Creating independent instances doesn't
require factory wrappers or providers.

```sh
npm install valuse
```

```ts
import { value, valueScope } from 'valuse';

const inboxScope = valueScope(
  // 1. Fields: the writable state each instance owns.
  {
    userId: value<string>(),
    lastReadAt: value<number>(0),
  },
  // 2. Async derivation: fetches whenever a tracked field changes.
  {
    notifications: async ({ scope, signal }) => {
      // `.use()` tracks userId; changing it aborts this fetch and reruns it.
      const res = await fetch(`/api/notifications/${scope.userId.use()}`, {
        signal,
      });
      return res.json();
    },
  },
  // 3. Sync derivation: reads the async one like any other field, no await.
  {
    unreadCount: ({ scope }) => {
      // notifications is undefined until the first fetch resolves.
      const notifs = scope.notifications.use() ?? [];
      const readAt = scope.lastReadAt.use();
      return notifs.filter((n) => n.ts > readAt).length;
    },
  },
);
```

Create an instance, interact with it:

```ts
const inbox = inboxScope.create({ userId: 'alice' });

inbox.unreadCount.get(); // 0 until the fetch resolves, then e.g. 3
inbox.lastReadAt.set(Date.now()); // unreadCount drops; no refetch
inbox.userId.set('bob'); // stale fetch aborts, a new one starts
inbox.notifications.recompute(); // refetch on demand
```

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

`valueScope()` takes one or more **layers**: fields first, then zero or more
derivation layers, then an optional config layer. The layered shape lets
TypeScript fully infer `scope` inside every derivation without a manual type
annotation. It also makes the dependency order visible at the call site and
makes circular derivations structurally impossible.

In React, import the side-effect bridge once anywhere in your app. It wires up
`useSyncExternalStore` so `.use()` hooks re-render on change:

```tsx
import 'valuse/react';

function UnreadBadge({ inbox }) {
  const [unreadCount] = inbox.unreadCount.use();
  return unreadCount > 0 ? <span className="badge">{unreadCount}</span> : null;
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

const userId = value<string>('alice');
const pollInterval = value<number>(30_000);
```

Read, write, and subscribe. No framework required:

```ts
userId.get(); // 'alice'
userId.set('bob');
userId.set((prev) => prev.toLowerCase()); // callback form
userId.subscribe((v) => console.log(v)); // logs on every change
```

In React, `.use()` returns the current value and re-renders on change:

```tsx
const [currentUser, setUser] = userId.use();
```

### Collections

> **Deep dive:**
> [docs/reactive-values.md#collections](docs/reactive-values.md#collections)

Reactive versions of Array, Set, and Map. Same core interface: `.get()`,
`.set()`, `.use()`, `.subscribe()`.

```ts
import { valueArray, valueSet, valueMap } from 'valuse';

const notifications = valueArray<Notification>();
notifications.set([notifA, notifB]);
notifications.push(notifC);
notifications.get(); // [notifA, notifB, notifC] (frozen)

const channels = valueSet<string>(['inbox', 'mentions']);
channels.add('updates');
channels.delete('mentions');
channels.has('updates'); // true

const unreadByChannel = valueMap<string, number>([
  ['inbox', 3],
  ['mentions', 1],
]);
unreadByChannel.get('inbox'); // 3
unreadByChannel.delete('mentions');
```

`valueMap` supports per-key subscriptions in React:

```tsx
const [inboxCount, setInbox] = unreadByChannel.use('inbox'); // only re-renders when inbox changes
const keys = unreadByChannel.useKeys(); // only re-renders when keys change
```

`valueArray` supports per-index subscriptions:

```tsx
const [latest, setLatest] = notifications.use(0); // only re-renders when index 0 changes
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
count.get(); // returns number: 42
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
const notification = value<Notification>({
  id: 'n1',
  text: '...',
}).compareUsing((a, b) => a.id === b.id);
```

`valueArray` has `compareElementsUsing()` for per-element comparison:

```ts
const notifications = valueArray<Notification>().compareElementsUsing(
  (a, b) => a.id === b.id,
);
```

### Pipeline ordering

When a value has both pipes and a custom comparator, the order is:

1. **set()**: raw input enters.
2. **pipe chain**: transforms run left to right.
3. **compareUsing()**: compared against current value.
4. **write**: if different, subscribers are notified.

This means comparison runs on the _post-pipe_ value, not the raw input.

### Batching

Group multiple writes so anything downstream — subscribers, derivations, React
re-renders — settles once instead of reacting to each `.set()` in turn:

```ts
import { batchSets } from 'valuse';

batchSets(() => {
  userId.set('bob');
  pollInterval.set(60_000);
});
// A derivation or effect that reads both recomputes once, not twice
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
  write `scope.preferences.email` without creating a separate scope. A nested
  object is just a plain object whose entries follow the same field-layer rules.
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
const inboxScope = valueScope(
  {
    userId: value<string>(),
    lastReadAt: value<number>(0),
    channels: valueSet<string>(['inbox']),
  },
  {
    notifications: async ({ scope, set, signal, deferBy }) => {
      while (!signal.aborted) {
        const res = await fetch(`/api/notifications/${scope.userId.use()}`, {
          signal,
        });
        set(await res.json());
        await deferBy(30_000);
      }
    },
  },
  {
    unreadCount: ({ scope }) => {
      const notifs = scope.notifications.use() ?? [];
      const readAt = scope.lastReadAt.use();
      return notifs.filter((n) => n.ts > readAt).length;
    },
  },
);
```

### Creating instances

```ts
const inbox = inboxScope.create({
  userId: 'alice',
  // lastReadAt defaults to 0
  // channels defaults to Set { 'inbox' }
});

const empty = inboxScope.create(); // all undefined or defaults
```

### Field access

Each reactive field (`value()`, `valueArray()`, `valueSet()`, `valueMap()`,
`valueSchema()`, `valueRef()`) exposes `.get()`, `.set()`, `.use()`, and
`.subscribe()`. Derivations have the same except `.set()`:

```ts
inbox.userId.get(); // 'alice'
inbox.userId.set('bob');
inbox.userId.set((prev) => prev.toLowerCase()); // callback form

inbox.channels.add('mentions');
inbox.channels.get(); // Set { 'inbox', 'mentions' }

inbox.unreadCount.get(); // 5
// inbox.unreadCount.set() -- doesn't exist; derivations are read-only
```

In React:

```tsx
const [userId, setUserId] = inbox.userId.use();
const [unreadCount] = inbox.unreadCount.use(); // derivation, no setter
```

### Instance methods

Instance-level methods use a `$` prefix to separate them from field names:

```ts
inbox.$get(); // resolved values, scope refs stay live
inbox.$getSnapshot(); // plain data, recursively resolved
inbox.$setSnapshot({ userId: 'bob', lastReadAt: Date.now() });
inbox.$use(); // React hook, re-renders on any change
inbox.$subscribe(fn); // whole-scope subscribe
inbox.$recompute(); // re-run all derivations
inbox.$destroy(); // tear down instance
```

`$getSnapshot()` resolves everything recursively to plain data, including across
scope ref boundaries. `$get()` stops at scope refs, leaving them as live
instances.

`$setSnapshot()` accepts a nested partial. Only reactive fields are written:

```ts
inbox.$setSnapshot({
  preferences: { email: true }, // updates preferences.email, leaves others alone
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
inbox.$setSnapshot(savedState, { recreate: true });
```

### Nesting

Scope definitions support [nesting](docs/scopes.md#nesting). Reactive `value()`
nodes can appear at any depth, with plain data as static readonly leaves:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),

    schemaVersion: 1, // plain data, readonly, not reactive

    preferences: {
      email: value<boolean>(true),
      push: value<boolean>(false),
    },
  },
  {
    summary: ({ scope }) => {
      const user = scope.userId.use();
      const email = scope.preferences.email.use();
      const push = scope.preferences.push.use();
      return `${user}: email=${email}, push=${push}`;
    },
  },
);

const inbox = inboxScope.create({
  userId: 'alice',
  preferences: { email: true, push: true },
});

inbox.preferences.push.get(); // true
inbox.preferences.push.set(false);
inbox.schemaVersion; // 1, just a value, no .get()
```

For cross-scope composition (sharing state between independent scopes), use
[`valueRef`](docs/refs.md) instead of nesting.

### Derivations

> **Deep dive:** [docs/derivations.md](docs/derivations.md)

Derivations are functions that compute values from other fields. They receive a
`scope` context for reading state:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    lastReadAt: value<number>(0),
    notifications: valueArray<Notification>(),
  },
  {
    // .use() tracked. Re-runs when notifications or lastReadAt change.
    // .get() untracked. Reads userId without re-running when it changes.
    unreadCount: ({ scope }) => {
      const notifs = scope.notifications.use();
      const readAt = scope.lastReadAt.use();
      const owner = scope.userId.get();
      return notifs.filter((n) => n.ts > readAt && n.recipient === owner)
        .length;
    },
  },
);
```

- **`.use()`**: tracked read. The derivation re-runs when this value changes.
- **`.get()`**: untracked read. Current value, no dependency.

A derivation with zero `.use()` calls is a constant; it runs once and never
recomputes. Call `.recompute()` on any derivation to manually trigger a re-run.

#### Async derivations

When a derivation is `async`, ValUse automatically manages abort, status
tracking, and cleanup. Here a user profile is fetched with
stale-while-revalidate from a local cache:

```ts
const profileScope = valueScope(
  { userId: value<string>() },
  {
    profile: async ({ scope, set, signal }) => {
      const id = scope.userId.use();
      const cached = sessionStorage.getItem(`profile:${id}`);
      if (cached) set(JSON.parse(cached)); // show cached immediately
      const res = await fetch(`/api/users/${id}`, { signal });
      const fresh = await res.json();
      sessionStorage.setItem(`profile:${id}`, JSON.stringify(fresh));
      return fresh; // replaces cached value
    },
  },
);

const profile = profileScope.create({ userId: 'alice' });
```

When `userId` changes, the previous fetch is aborted via `signal` and a new one
starts. `set()` pushes the cached value immediately so the UI never shows an
empty state. When the fetch resolves, `return` replaces it with fresh data.

Async derivations have an `AsyncState` for status tracking:

```tsx
const [profileData, profileState] = profile.profile.useAsync();

if (profileState.isPending) return <Spinner />;
if (profileState.isError) return <Error error={profileState.error} />;
return <Avatar user={profileData} />;
```

`.use()` returns `[T | undefined]` (just the value, no status). Use
`.useAsync()` when you need the state alongside it.

Sync derivations can depend on async ones without knowing they're async.
`.use()` returns `T | undefined`; no promises, no `await`:

```ts
const profileScope = valueScope(
  { userId: value<string>() },
  {
    profile: async ({ scope, signal }) => {
      const res = await fetch(`/api/users/${scope.userId.use()}`, { signal });
      return res.json();
    },
  },
  {
    // Sync. Just sees Profile | undefined. Recomputes when profile resolves.
    initials: ({ scope }) => {
      const p = scope.profile.use();
      if (!p) return '';
      return p.firstName[0] + p.lastName[0];
    },
  },
);
```

If you later change `profile` from sync to async (or vice versa), `initials`
doesn't change at all.

You can also seed an async derivation with cached data at creation time:

```ts
const profile = profileScope.create({
  userId: 'alice',
  profile: cachedProfile, // available immediately via .get(), replaced when fetch resolves
});
```

> **Deep dive:** [docs/async-derivations.md](docs/async-derivations.md)

### Plain data in scopes

Any entry in the field layer that isn't a reactive primitive or a nested object
is treated as static readonly data. It travels with the instance but doesn't
participate in reactivity:

```ts
const inboxScope = valueScope({
  userId: value<string>(),
  schemaVersion: 1,
  defaultPrefs: { pollMs: 30_000, maxItems: 50 },
});

const inbox = inboxScope.create({ userId: 'alice' });
inbox.schemaVersion; // 1
inbox.defaultPrefs; // { pollMs: 30_000, maxItems: 50 } (frozen)
```

For non-reactive data that you still need to read and write, use `valuePlain()`.
It has `.get()` and `.set()` but is invisible to the reactive graph. Changes
won't trigger re-renders or re-derivations:

```ts
const inboxScope = valueScope({
  userId: value<string>(),
  metadata: valuePlain({ lastSyncedAt: 0 }),
  config: valuePlain({ pollMs: 30_000 }, { readonly: true }),
});

const inbox = inboxScope.create({ userId: 'alice' });
inbox.metadata.get(); // { lastSyncedAt: 0 }
inbox.metadata.set({ lastSyncedAt: Date.now() });
inbox.config.set({ pollMs: 60_000 }); // throws, readonly
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
// id, type, isHighlighted: reactive
// text, children, bold, italic: preserved but not reactive
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
inbox.lastReadAt.subscribe((value, previousValue) => {
  console.log(`read marker moved: ${previousValue} → ${value}`);
});
```

### Whole-scope subscribe

```ts
inbox.$subscribe(() => {
  console.log('something changed:', inbox.$getSnapshot());
});
```

### onChange

Fires after mutations. Batched: multiple synchronous sets produce one call. Uses
`changesByScope` to check which parts of the tree changed:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    lastReadAt: value<number>(0),
    lastSyncedAt: value<number>(0),
    preferences: {
      email: value<boolean>(true),
    },
  },
  {
    onChange: ({ scope, changes, changesByScope }) => {
      if (changesByScope.has(scope.preferences)) {
        console.log('preferences changed');
      }
      scope.lastSyncedAt.set(Date.now());
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
const inboxScope = valueScope(
  {
    userId: value<string>(),
    preferences: {
      email: value<boolean>(true),
    },
  },
  {
    beforeChange: ({ scope, changes, prevent }) => {
      // `changes` always holds exactly one change here.
      const [change] = changes;

      // Prevent a specific field
      if (change.path === 'userId') prevent(change);

      // Prevent everything under a nested subtree
      if (change.to === '') prevent(scope.preferences);

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
// Empty collection (e.g., multi-account inboxes)
const inboxes = inboxScope.createMap();

// From an array, keyed by field name
const inboxes = inboxScope.createMap(accounts, 'userId');

// From an array, keyed by callback
const inboxes = inboxScope.createMap(accounts, (acct) => acct.userId);

// From a Map
const inboxes = inboxScope.createMap(
  new Map([
    ['alice', { userId: 'alice', lastReadAt: 1717700000 }],
    ['bob', { userId: 'bob', lastReadAt: 1717690000 }],
  ]),
);
```

Add, update, and remove entries after creation:

```ts
inboxes.set('carol', { userId: 'carol' });
inboxes.delete('carol'); // fires onDestroy for that instance
inboxes.has('carol'); // boolean
inboxes.keys(); // string[]
inboxes.size; // number of entries
inboxes.clear(); // remove all, fires onDestroy for each
```

Access fields directly on the instance:

```ts
const alice = inboxes.get('alice');
alice.lastReadAt.get(); // 1717700000
alice.lastReadAt.set(Date.now());
alice.$destroy();
```

In React:

```tsx
function InboxRow({ inbox }) {
  const [unreadCount] = inbox.unreadCount.use();
  const [userId] = inbox.userId.use();
  return (
    <li>
      {userId}: {unreadCount} unread
    </li>
  );
}

function AccountList({ inboxes }) {
  const keys = inboxes.useKeys();
  return keys.map((id) => <InboxRow key={id} inbox={inboxes.get(id)} />);
}
```

### valueRef: scope composition

> **Deep dive:** [docs/refs.md](docs/refs.md)

Use `valueRef()` to bring external reactive state into a scope. Refs are shared
across all instances. They point to the same source, not a copy:

```ts
import { valueRef } from 'valuse';

const connectionStatus = value<'online' | 'offline'>('online');

const inboxScope = valueScope({
  userId: value<string>(),
  connection: valueRef(connectionStatus),
});
```

Per-instance refs with factories. Each instance gets its own nested collection:

```ts
const channelScope = valueScope({
  id: value<string>(),
  name: value<string>(),
  muted: value<boolean>(false),
});

const inboxScope = valueScope(
  {
    userId: value<string>(),
    channels: valueRef(() => channelScope.createMap()),
  },
  {
    activeChannels: ({ scope }) => scope.channels.use().size,
  },
);
```

Reactivity flows through refs. A derivation that reads a ref's fields via
`use()` will re-run when those fields change, just like any other dependency.

Lifecycle is [transitive](docs/refs.md#transitive-lifecycle) too. When a scope
gets its first subscriber (triggering [`onUsed`](#lifecycle-hooks-and-signals)),
all scopes it references via `valueRef()` also become "used," activating their
`onUsed` hooks. When the last subscriber detaches, referenced scopes are
notified as well. (Derivations themselves don't wait for `onUsed`; they run
eagerly from `create()`, and only the hooks are gated on usage.)

### Extending scopes

> **Deep dive:** [docs/extending.md](docs/extending.md)

`.extendValues()` adds new state and derivations; `.extendConfig()` attaches
lifecycle hooks. Both return new templates that include everything from the
original:

```ts
const trackedInbox = inboxScope
  .extendValues({ lastSyncedAt: value<number>(Date.now()) })
  .extendConfig({
    onChange: ({ scope }) => {
      scope.lastSyncedAt.set(Date.now());
    },
  });
```

Remove fields with `undefined`:

```ts
const simplified = inboxScope.extendValues({
  preferences: undefined, // removes the nested preferences object. TypeScript catches broken refs.
});
```

Since `.extendValues()` and `.extendConfig()` take a scope and return a scope,
middleware is just a function:

```ts
const withTracking = (scope) =>
  scope.extendValues({ lastSyncedAt: value<number>(Date.now()) }).extendConfig({
    onChange: ({ scope }) => scope.lastSyncedAt.set(Date.now()),
  });

const withArchive = (scope) =>
  scope.extendValues({ archived: value<boolean>(false) });

const fullInbox = withArchive(withTracking(inboxScope));
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
  isPending: boolean; // setting && !hasValue; "first load, show a spinner"
  isUpdating: boolean; // setting && hasValue; new value computing, keep current on screen
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
notifications: async ({ scope, set, signal }) => {
  const id = scope.userId.use();
  const cached = localStorage.getItem(`notifs:${id}`);
  if (cached) set(JSON.parse(cached));  // show cached immediately
  const res = await fetch(`/api/notifications/${id}`, { signal });
  return res.json();                    // replace with fresh data
},
```

#### Cleanup

Register cleanup functions with `onCleanup()`. They run when the derivation
re-runs or when the instance is destroyed:

```ts
notifications: async ({ scope, set, onCleanup }) => {
  const es = new EventSource(`/api/notifications/${scope.userId.use()}/stream`);
  onCleanup(() => es.close());
  es.onmessage = (e) => set((prev) => [...(prev ?? []), JSON.parse(e.data)]);
},
```

#### Dependency tracking

`.use()` works anywhere in async derivations, before or after `await`.
Dependencies are tracked eagerly via per-call subscriptions. If a tracked dep
changes mid-flight, the abort signal fires immediately and the derivation
re-runs:

```ts
notifications: async ({ scope, signal }) => {
  const id = scope.userId.use();
  const res = await fetch(`/api/notifications/${id}`, { signal });
  const data = await res.json();

  if (data.requiresUpgrade) {
    const tier = scope.accountTier.use(); // works after await
    return fetchWithTier(`/api/notifications/${id}`, tier, { signal });
  }
  return data;
},
```

#### Long-running derivations

Since `set()` can push values at any point during execution, putting it inside a
loop creates a long-running process. This is a natural fit for polling,
WebSocket streams, or any open-ended data source:

```ts
const inboxScope = valueScope(
  { userId: value<string>() },
  {
    notifications: async ({ scope, set, signal, deferBy }) => {
      const id = scope.userId.use();
      if (!id) return;
      while (!signal.aborted) {
        const res = await fetch(`/api/notifications/${id}`, { signal });
        if (!signal.aborted) set(await res.json());
        await deferBy(30_000);
      }
      // Loop runs until signal aborts; values come from set()
    },
  },
);
```

When `userId` changes, the previous loop is aborted and a new one starts. When
the instance is destroyed, it's aborted automatically.

> **Eager start:** the loop begins the moment the instance is created; it
> doesn't wait for a subscriber. Derivations run eagerly; only the
> [`onUsed` / `onUnused` hooks](#lifecycle-hooks-and-signals) are gated on
> usage. So a created-but-never-rendered instance (or every entry in a large
> `ScopeMap`) keeps polling regardless.

To poll only while something is observing, gate the loop on a flag field that
`onUsed` / `onUnused` toggle:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    shouldPoll: value<boolean>(false),
  },
  {
    notifications: async ({ scope, set, signal, deferBy }) => {
      if (!scope.shouldPoll.use()) return; // tracked: reruns when the flag flips
      const id = scope.userId.use(); // tracked: restarts when userId changes
      while (!signal.aborted) {
        const res = await fetch(`/api/notifications/${id}`, { signal });
        if (!signal.aborted) set(await res.json());
        await deferBy(30_000);
      }
    },
  },
  {
    onUsed: ({ scope }) => scope.shouldPoll.set(true),
    onUnused: ({ scope }) => scope.shouldPoll.set(false),
  },
);
```

The derivation still runs on create, but it sees `shouldPoll === false` and
returns right away. The first subscriber flips the flag via `onUsed`, so the
derivation reruns and the loop starts; when the last subscriber detaches,
`onUnused` flips it back and the loop aborts.

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
const inboxScope = valueScope(
  {
    userId: value<string>(),
    isOnline: value<boolean>(navigator.onLine),
  },
  {
    onCreate: ({ scope, signal, onCleanup }) => {
      // signal: pass to APIs that accept it
      window.addEventListener('online', () => scope.isOnline.set(true), {
        signal,
      });
      window.addEventListener('offline', () => scope.isOnline.set(false), {
        signal,
      });

      // onCleanup: for everything else
      const heartbeat = setInterval(() => ping(scope.userId.get()), 60_000);
      onCleanup(() => clearInterval(heartbeat));
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
const createInbox = (pollMs: number, endpoint: string) =>
  valueScope(
    { userId: value<string>() },
    {
      notifications: async ({ scope, set, signal, deferBy }) => {
        while (!signal.aborted) {
          const res = await fetch(`${endpoint}/${scope.userId.use()}`, {
            signal,
          });
          set(await res.json());
          await deferBy(pollMs);
        }
      },
    },
  );

const fastInbox = createInbox(5_000, '/api/v2/notifications');
const legacyInbox = createInbox(60_000, '/api/v1/notifications');
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
const PollInterval = type('5000 <= number <= 300000');

const prefsScope = valueScope(
  {
    email: valueSchema(Email, ''),
    pollMs: valueSchema(PollInterval, 30_000),
    quietStart: valueSchema(type('0 <= number <= 23'), 22),
    quietEnd: valueSchema(type('0 <= number <= 23'), 7),
  },
  {
    validate: ({ scope }) => {
      const issues: StandardSchemaV1.Issue[] = [];
      if (scope.quietStart.use() === scope.quietEnd.use()) {
        issues.push({
          message: 'Quiet hours must have a range',
          path: ['quietEnd'],
        });
      }
      return issues;
    },
  },
);
```

Types flow from the schema. No manual type annotations needed:

```ts
const prefs = prefsScope.create();

prefs.email.set('not-an-email');
prefs.email.get(); // 'not-an-email' (whatever was last set)
prefs.email.getValidation();
// { isValid: false, value: 'not-an-email', issues: [...] }

prefs.email.set('alice@example.com');
prefs.email.get(); // 'alice@example.com'
prefs.email.getValidation();
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
function EmailPref() {
  const prefs = usePrefs();
  const [email, setEmail, validation] = prefs.email.useValidation();

  return (
    <div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      {!validation.isValid && (
        <span className="error">{validation.issues[0]?.message}</span>
      )}
    </div>
  );
}

function SaveButton() {
  const prefs = usePrefs();
  const isValid = prefs.$useIsValid();

  return (
    <button type="submit" aria-disabled={!isValid}>
      Save preferences
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

ValUse ships four batteries-included middleware wrappers for the most common
scope patterns, plus storage adapters for `withPersistence` and standalone
`connectDevtools` / `connectMapDevtools` helpers. Everything lives at
`valuse/middleware`:

| Middleware        | Purpose                                           | Deep dive                                  |
| ----------------- | ------------------------------------------------- | ------------------------------------------ |
| `withActions`     | Typed imperative actions (methods) on instances   | [docs/actions.md](docs/actions.md)         |
| `withDevtools`    | Redux DevTools integration, timeline, time travel | [docs/devtools.md](docs/devtools.md)       |
| `withPersistence` | Sync state to localStorage, IndexedDB, or custom  | [docs/persistence.md](docs/persistence.md) |
| `withHistory`     | Undo/redo with bounded depth and batched typing   | [docs/history.md](docs/history.md)         |

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

// Compose freely; each middleware takes and returns a ScopeTemplate.
const persistedInbox = withDevtools(
  withPersistence(withHistory(inboxScope), {
    key: 'inbox',
    adapter: localStorageAdapter,
  }),
  { name: 'inbox' },
);

const inbox = persistedInbox.create({ userId: 'alice' });
inbox.lastReadAt.set(Date.now());
inbox.$undo(); // history: revert "mark as read"
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

const searchFilter = value<string>('')
  .pipe((v) => v.trim())
  .pipe(pipeDebounce(300));

const scrollPosition = value<number>(0).pipe(pipeThrottle(16));

const readHistory = value<string>('').pipe(
  pipeScan((acc, v) => [...acc, v], []),
);
// set('n1') → ['n1'], set('n2') → ['n1', 'n2']
```

Available factory pipes: `pipeDebounce`, `pipeThrottle`, `pipeBatch`,
`pipeFilter`, `pipeScan`, `pipeUnique`. Also available: `pipeEnum` (sync
transform that narrows values to an allowed set, falling back to the first
element for invalid input).

### Type-changing pipes

Type changes compose down the chain: each `.pipe()` can transform the type
again, so a value's stored output can sit several hops from its `set()` input
(the basics are in [Transforms](#transforms)):

```ts
const flag = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.length) // string → number
  .pipe((v) => v > 0); // number → boolean

flag.set('hello'); // accepts string
flag.get(); // returns boolean: true
```

### Manual recompute

Trigger re-runs of derivations that use only `.get()` (untracked reads):

```ts
inbox.notifications.recompute(); // single derivation (aborts + restarts polling)
inbox.$recompute(); // all derivations
```

### Type guards

Runtime type narrowing for middleware and generic utilities:

```ts
import { isValue, isSchema, isPlain, isComputed, isScope } from 'valuse';

isValue(inbox.userId); // true, has .get(), .set(), .use()
isSchema(prefs.email); // true, has .getValidation(), .useValidation()
isPlain(inbox.metadata); // true, has .get(), .set(), no .use()
isComputed(inbox.unreadCount); // true, has .get(), .use(), no .set()
isScope(inbox); // true, scope instance
```

> **Note:** a schema-validated field is also a value field, so
> `isValue(prefs.email)` returns `true` for a `valueSchema` slot. When
> narrowing, check the more specific predicate first:
>
> ```ts
> if (isSchema(field)) { ...validation-aware path... }
> else if (isValue(field)) { ...plain reactive value... }
> ```

---

## API Reference

### Primitives

| Export                   | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `value<T>()`             | Reactive value, starts as `undefined`               |
| `value<T>(default)`      | Reactive value with default                         |
| `valueSet<T>()`          | Reactive Set                                        |
| `valueMap<K, V>()`       | Reactive Map                                        |
| `valueArray<T>()`        | Reactive Array with index subscriptions             |
| `valuePlain<T>(default)` | Non-reactive get/set container                      |
| `valueSchema(s, def)`    | Schema-validated reactive value (Standard Schema)   |
| `valueRef(source)`       | Reference to external reactive state (shared)       |
| `valueRef(() => source)` | Per-instance ref; factory called on each `create()` |
| `batchSets(fn)`          | Group writes; subscribers fire once                 |

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
| `.use()`            | React hook: `[value, setter]`, re-renders on change  |
| `.subscribe(fn)`    | Listen for changes, returns unsubscribe              |
| `.pipe(fn)`         | Transform on set, chainable, can change type         |
| `.pipe(factory)`    | Factory pipe for stateful transforms                 |
| `.flush()`          | Cascade flush of pipe chain (async, returns Promise) |
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
| `.use()`                     | React hook: whole array                    |
| `.use(index)`                | React hook: single index (negative ok)     |
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

| Method             | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `.get()`           | Read value                                                            |
| `.set(value)`      | Write value (callback: `prev => next`). Values only.                  |
| `.use()`           | React hook: `[value, setter]` or `[value]` for derivations            |
| `.subscribe(fn)`   | Per-field change listener: `fn(value, previousValue)`                 |
| `.flush()`         | Expedite deferred work, await settle. Values and async derivations.   |
| `.recompute()`     | Re-run this derivation. Derived fields only.                          |
| `.useAsync()`      | React hook: `[value, AsyncState<T>]`. Async derived fields only.      |
| `.getAsync()`      | Read `AsyncState<T>`. Async derived fields only.                      |
| `.useValidation()` | React hook: `[value, setter, ValidationState<In, Out>]`. Schema only. |
| `.getValidation()` | Read `ValidationState<In, Out>`. Schema fields only.                  |

### Instance $ methods

| Method                           | Description                                                |
| -------------------------------- | ---------------------------------------------------------- |
| `.$get()`                        | Resolved values, scope refs stay live                      |
| `.$getSnapshot()`                | Plain data, everything recursively resolved                |
| `.$setSnapshot(d)`               | Partial write, reactive fields only                        |
| `.$setSnapshot(d, { recreate })` | Write + re-run onDestroy then onCreate                     |
| `.$use()`                        | React hook: `[snapshot, setter]`, re-renders on any change |
| `.$subscribe(fn)`                | Whole-scope change listener                                |
| `.$destroy()`                    | Tear down, fire onDestroy, detach all subscribers          |
| `.$recompute()`                  | Re-run all derivations                                     |
| `.$flush()`                      | Expedite pending deferred work, layer-ordered cascade      |
| `.$getIsValid(opts?)`            | True when all schema fields and `validate` pass            |
| `.$useIsValid(opts?)`            | React hook: re-renders when overall validity changes       |
| `.$getValidation(opts?)`         | `{ isValid, issues }` with scope-relative paths            |
| `.$useValidation(opts?)`         | React hook: re-renders when issue list changes             |

### ScopeMap methods

| Method                                 | Description                             |
| -------------------------------------- | --------------------------------------- |
| `.get(key)`                            | Get the instance for a key              |
| `.set(key, data)`                      | Add or update an instance               |
| `.delete(key)`                         | Remove and destroy an instance          |
| `.keys()` / `.values()` / `.entries()` | List keys, instances, or both           |
| `.has(key)`                            | Check if key exists                     |
| `.size`                                | Number of entries                       |
| `.useKeys()`                           | React hook: re-renders on add/remove    |
| `.subscribe(fn)`                       | Listen for key-list changes             |
| `.clear()`                             | Remove all, fires `$destroy()` for each |

### Scope config

| Option         | Description                                                           |
| -------------- | --------------------------------------------------------------------- |
| `onCreate`     | `{ scope, input, signal, onCleanup }`. Once on create.                |
| `beforeChange` | `{ scope, changes, changesByScope, prevent }`. Sync, pre-write.       |
| `onChange`     | `{ scope, changes, changesByScope }`. Batched, post-write.            |
| `onUsed`       | `{ scope, signal, onCleanup }`. First subscriber attaches.            |
| `onUnused`     | `{ scope }`. Last subscriber detaches.                                |
| `onDestroy`    | `{ scope }`. Instance destroyed.                                      |
| `validate`     | `{ scope }`. Reactive derivation, returns `StandardSchemaV1.Issue[]`. |

### Derivation context

| Property        | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `scope`         | Root scope. Access fields via `scope.field.use()` / `.get()`. |
| `signal`        | _(Async)_ AbortSignal, aborted on dep change or destroy.      |
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

| Path                | Contents                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| `valuse`            | Core: `value`, `valueScope`, `valueSet`, `valueMap`, `valueArray`, types            |
| `valuse/react`      | React bridge: `import 'valuse/react'` to enable `.use()` hooks                      |
| `valuse/utils`      | Pipe factories, async derivation helpers, and signal primitives                     |
| `valuse/middleware` | Shipped middleware: `withActions`, `withDevtools`, `withPersistence`, `withHistory` |
