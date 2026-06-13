# valueRef: Scope Composition

`valueRef()` brings external reactive state into a scope definition. Instead of
copying values, a ref points to a live source. All instances of the scope read
from the same source (shared refs) or each get their own (factory refs).

Refs are the primary composition mechanism in ValUse. Rather than deeply
[nesting scopes](scopes.md#nesting) or passing props, you connect independent
pieces of state through refs and let the reactive graph handle updates.

## Table of contents

- [Shared refs](#shared-refs)
- [Factory refs](#factory-refs)
- [Reactivity through refs](#reactivity-through-refs)
- [Ref sources](#ref-sources)
- [Refs to scope instances](#refs-to-scope-instances)
- [Transitive lifecycle](#transitive-lifecycle)
- [Patterns](#patterns)

---

## Shared refs

The simplest form of ref points to a shared reactive source. Every instance of
the scope reads from the same value:

```ts
import { value, valueRef, valueScope, valueSet } from 'valuse';

const connectionStatus = value<'online' | 'offline'>('online');
const activeLabels = valueSet(['inbox', 'sent']);

const inboxScope = valueScope({
  userId: value<string>(),
  connection: valueRef(connectionStatus),
  labels: valueRef(activeLabels),
});

const alice = inboxScope.create({ userId: 'alice' });
const bob = inboxScope.create({ userId: 'bob' });

alice.connection.get(); // 'online'
bob.connection.get(); // 'online', same source

connectionStatus.set('offline');
alice.connection.get(); // 'offline'
bob.connection.get(); // 'offline', both updated
```

Refs are read-only on the instance. To write, use the original source directly.

## Factory refs

When each instance needs its own independent state, pass a factory function to
`valueRef()`. The factory is called once per `.create()`:

```ts
const threadScope = valueScope({
  threadId: value<string>(),
  subject: value<string>(),
  isRead: value(false),
});

const inboxScope = valueScope({
  userId: value<string>(),
  threads: valueRef(() => threadScope.createMap()),
});

const alice = inboxScope.create({ userId: 'alice' });
const bob = inboxScope.create({ userId: 'bob' });

// Each inbox gets its own independent ScopeMap
alice.threads.get(); // Map {}
bob.threads.get(); // Map {}, different instance
```

Factory refs are useful for composition patterns where each parent instance owns
a child collection or nested scope.

## Reactivity through refs

Derivations can read through refs using `.use()`. Reactivity flows through the
ref boundary:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    threads: valueRef(() => threadScope.createMap()),
  },
  {
    threadCount: ({ scope }) => scope.threads.use().size,
  },
);

const inbox = inboxScope.create({ userId: 'alice' });
inbox.threadCount.get(); // 0

inbox.threads.set('t1', { threadId: 't1', subject: 'Welcome' });
inbox.threadCount.get(); // 1
```

When `threads` changes (entries added or removed), `threadCount` recomputes
automatically. The reactive graph does not care that the data comes from a ref;
`.use()` tracks the dependency the same way. For a `ScopeMap` ref, `.use()`
tracks both membership and every member's fields, so a derivation that reads
into entries re-runs when those entries change, not only when the key list does
(see [Per-instance child collections](#per-instance-child-collections)).

## Ref sources

`valueRef()` accepts several source types:

| Source type     | What `.get()` returns          |
| --------------- | ------------------------------ |
| `Value<T>`      | The value's current output     |
| `ValueSet<T>`   | The current `Set<T>`           |
| `ValueMap<K,V>` | The current `Map<K,V>`         |
| Scope instance  | The instance's `$get()` result |
| `{ get(): T }`  | Whatever `.get()` returns      |
| `() => T`       | Factory, called per instance   |

```ts
// Value
valueRef(value('hello'));

// ValueSet
valueRef(valueSet(['a', 'b']));

// ValueMap
valueRef(valueMap([['x', 1]]));

// Any object with .get()
valueRef({ get: () => computeExpensiveThing() });

// Factory
valueRef(() => valueMap());
```

## Refs to scope instances

You can ref an entire scope instance. Outside a derivation, the ref's `.get()`
returns the instance's snapshot. Inside a derivation, `scope.<ref>.use()` hands
back the referenced instance itself, so you can reach into its fields with the
usual `.get()` / `.use()` pattern:

```ts
const preferencesScope = valueScope({
  pollInterval: value(30_000),
  maxResults: value(50),
});

const globalPreferences = preferencesScope.create({ pollInterval: 10_000 });

const inboxScope = valueScope(
  { preferences: valueRef(globalPreferences) },
  {
    pollLabel: ({ scope }) =>
      `Polling every ${scope.preferences.use().pollInterval.get() / 1000}s`,
  },
);
```

This is useful for sharing configuration or global state across multiple scope
types without coupling their definitions.

## Transitive lifecycle

Lifecycle hooks flow through ref boundaries. When a scope instance transitions
to "used" (its first subscriber attaches), all scopes it references via
`valueRef()` also become "used." This activates their `onUsed` hooks and async
derivations.

When the last subscriber detaches, referenced scopes receive `onUnused` as well.

```ts
const notificationSource = valueScope(
  {
    notifications: value<Notification[]>([]),
  },
  {
    onUsed: ({ scope, onCleanup }) => {
      const ws = new WebSocket('/ws/notifications');
      ws.onmessage = (e) => scope.notifications.set(JSON.parse(e.data));
      onCleanup(() => ws.close());
    },
  },
);

const sharedSource = notificationSource.create();

const inboxScope = valueScope(
  { source: valueRef(sharedSource) },
  { count: ({ scope }) => scope.source.use().notifications.get().length },
);

const inbox = inboxScope.create();
// When inbox gets its first subscriber, sharedSource's onUsed fires
// and the WebSocket opens.
```

This means you can define data sources as standalone scopes with `onUsed`
activation, then compose them into larger scopes via refs. The lifecycle
management is automatic. For full details on `onUsed`/`onUnused`, see
[Lifecycle: onUsed](lifecycle.md#onused).

## Patterns

### Global state injection

```ts
const authState = value<{ userId: string; role: string } | null>(null);

const inboxScope = valueScope(
  { auth: valueRef(authState) },
  { canManage: ({ scope }) => scope.auth.use()?.role === 'admin' },
);
```

### Per-instance child collections

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    threads: valueRef(() => threadScope.createMap()),
  },
  {
    threadCount: ({ scope }) => scope.threads.use().size,
    hasUnread: ({ scope }) =>
      scope.threads
        .use()
        .values()
        .some((t) => !t.isRead.get()),
  },
);
```

`.use()` on a `ScopeMap` ref deep-tracks its members: the derivation re-runs
when an entry is added or removed, and when any field on any member changes. So
`hasUnread` re-evaluates the moment any thread's `isRead` flips, not only when
threads are added or removed. This mirrors how an instance ref tracks all of a
referenced instance's fields.

The tracking is coarse by design, since comparison and aggregation usually
depend on every member, and it is pull-based, so members added later are tracked
automatically. For an untracked read, use `.get()` instead of `.use()`. When a
derivation returns a fresh array or object built from members, guard referential
stability yourself (for example, compare against `previousValue`) so you do not
notify on changes that did not affect the result.

### Shared configuration

```ts
const pollInterval = value<number>(30_000);

const inboxScope = valueScope(
  {
    pollInterval: valueRef(pollInterval),
    userId: value<string>(),
  },
  {
    pollLabel: ({ scope }) =>
      `Refreshing every ${scope.pollInterval.use() / 1000}s`,
  },
);
```

### Cross-scope communication

Refs are read-only on the instance. The consumer reads through the ref; the
producer writes to the shared source directly:

```ts
const eventBus = valueMap<string, unknown>();

const producer = valueScope(
  { events: valueRef(eventBus) },
  {
    publish: () => (type: string, data: unknown) => {
      eventBus.set((draft) => {
        draft.set(type, data);
      });
    },
  },
);

const consumer = valueScope(
  { events: valueRef(eventBus) },
  { lastNotification: ({ scope }) => scope.events.use().get('notification') },
);
```
