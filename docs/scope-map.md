# ScopeMap

A `ScopeMap` is a keyed collection of scope instances that share the same
template. Each entry is an independent reactive instance with its own state,
derivations, and lifecycle. The key list itself is observable, so React
components can re-render when instances are added or removed.

Use `ScopeMap` when you have many instances of the same shape: accounts in a
multi-inbox view, threads in a channel, entries in a cache, players in a game.
Templates can be specialized with [`.extendValues()`](extending.md) before
creating a map.

## Table of contents

- [Creating a ScopeMap](#creating-a-scopemap)
- [Adding and updating entries](#adding-and-updating-entries)
- [Reading entries](#reading-entries)
- [Removing entries](#removing-entries)
- [Iterating](#iterating)
- [Subscribing to key changes](#subscribing-to-key-changes)
- [React integration](#react-integration)
- [Typed keys](#typed-keys)
- [Lifecycle and cleanup](#lifecycle-and-cleanup)

---

## Creating a ScopeMap

Call `.createMap()` on any scope template:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    lastReadAt: value<number>(0),
    messages: valueArray<{ ts: number; read: boolean }>(),
  },
  {
    unreadCount: ({ scope }) => {
      const readAt = scope.lastReadAt.use();
      return scope.messages.use().filter((m) => m.ts > readAt).length;
    },
  },
);

// Empty collection
const inboxes = inboxScope.createMap();

// Pre-populated from a Map
const inboxes = inboxScope.createMap(
  new Map([
    ['alice', { userId: 'alice', lastReadAt: 1717776000 }],
    ['bob', { userId: 'bob', lastReadAt: 1717780000 }],
  ]),
);

// Pre-populated from [key, data] tuples
const inboxes = inboxScope.createMap([
  ['alice', { userId: 'alice', lastReadAt: 1717776000 }],
  ['bob', { userId: 'bob', lastReadAt: 1717780000 }],
]);
```

Each entry in the data argument goes through `.create()` on the template, so all
initialization rules (defaults, derivations, lifecycle hooks) apply normally.

## Adding and updating entries

`.set()` either creates a new instance or updates an existing one:

```ts
// Create new, calls template.create() under the hood
inboxes.set('carol', { userId: 'carol', lastReadAt: 0 });

// Update existing, calls $setSnapshot() on the instance
inboxes.set('carol', { lastReadAt: Date.now() });

// Create with defaults only
inboxes.set('empty', {});
```

When updating an existing entry, only the provided fields are written. Fields
not in the update object are left unchanged.

## Reading entries

```ts
const alice = inboxes.get('alice'); // ScopeInstance | undefined
alice?.userId.get(); // 'alice'
alice?.unreadCount.get(); // 5

inboxes.has('alice'); // true
inboxes.has('nobody'); // false
inboxes.size; // 3
```

The instance returned by `.get()` is a live scope instance. You can read fields,
set values, subscribe, and use React hooks on it.

## Removing entries

`.delete()` removes an instance and calls `$destroy()` on it:

```ts
inboxes.delete('alice'); // true, instance destroyed
inboxes.delete('nobody'); // false, key not found
```

`.clear()` removes all instances, calling `$destroy()` on each:

```ts
inboxes.clear(); // all instances destroyed, size is 0
```

Destruction runs lifecycle hooks (`onDestroy`), aborts async derivations, and
cleans up subscriptions. See [Lifecycle hooks](lifecycle.md) for details.

## Iterating

```ts
inboxes.keys(); // ['alice', 'bob'], array of keys
inboxes.values(); // [aliceInstance, bobInstance], array of instances
inboxes.entries(); // [['alice', aliceInstance], ['bob', bobInstance]]
```

These methods return fresh arrays on each call. They are snapshots, not live
views.

## Subscribing to key changes

`.subscribe()` fires when the key list changes (instances added or removed). It
does not fire when fields within an existing instance change:

```ts
const unsub = inboxes.subscribe((keys) => {
  console.log('Current accounts:', keys);
});

inboxes.set('dave', { userId: 'dave', lastReadAt: 0 });
// logs: Current accounts: ['alice', 'bob', 'dave']

inboxes.get('alice')!.lastReadAt.set(Date.now());
// does NOT fire, key list didn't change
```

For per-field changes within an instance, use the instance's own `.subscribe()`
or `$subscribe()`.

## React integration

### useKeys()

`useKeys()` returns the current key list and re-renders the component when keys
are added or removed:

```tsx
function InboxList({ inboxes }) {
  const keys = inboxes.useKeys();
  return (
    <ul>
      {keys.map((key) => (
        <InboxRow key={key} inbox={inboxes.get(key)!} />
      ))}
    </ul>
  );
}
```

The parent component re-renders when entries are added or removed. Individual
`InboxRow` components only re-render when their own fields change, because they
subscribe to individual field values via `.use()`.

### Per-instance hooks

Pass the instance down to child components and use field-level `.use()`:

```tsx
function InboxRow({ inbox }) {
  const [userId] = inbox.userId.use();
  const [unreadCount] = inbox.unreadCount.use();
  return (
    <tr>
      <td>{userId}</td>
      <td>{unreadCount} unread</td>
    </tr>
  );
}
```

This pattern gives you fine-grained reactivity: changes to one account's unread
count only re-render that account's row.

## Typed keys

The key type defaults to `string | number`. Narrow it with a type parameter:

```ts
const inboxesByNumber = inboxScope.createMap<number>(); // numeric keys
const inboxesByEmail = inboxScope.createMap<string>(); // string keys only
```

The type parameter flows through to `.get()`, `.set()`, `.delete()`, `.keys()`,
and all other methods.

## Lifecycle and cleanup

Each instance in a `ScopeMap` has its own lifecycle. The scope's `onCreate` hook
fires when `.set()` creates a new instance. `onDestroy` fires when `.delete()`
or `.clear()` removes one.

```ts
const tracked = valueScope(
  { userId: value<string>() },
  {
    onCreate: ({ scope }) => console.log('connected:', scope.userId.get()),
    onDestroy: ({ scope }) => console.log('disconnected:', scope.userId.get()),
  },
);

const map = tracked.createMap();
map.set('alice', { userId: 'alice' }); // logs: connected: alice
map.delete('alice'); // logs: disconnected: alice
map.clear(); // logs onDestroy for each remaining entry
```

Destroying the collection (or letting it be garbage collected) does not
automatically destroy instances. Always call `.clear()` or `.delete()` to
trigger proper cleanup. For per-instance child collections owned by a parent
scope, see
[Refs: Per-instance child collections](refs.md#per-instance-child-collections).
