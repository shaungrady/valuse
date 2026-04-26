# ScopeMap

A `ScopeMap` is a keyed collection of scope instances that share the same
template. Each entry is an independent reactive instance with its own state,
derivations, and lifecycle. The key list itself is observable, so React
components can re-render when instances are added or removed.

Use `ScopeMap` when you have many instances of the same shape: rows in a table,
items in a list, entries in a cache, players in a game. Templates can be
specialized with [`.extend()`](extending.md) before creating a map.

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
const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  fullName: ({ scope }) => `${scope.firstName.use()} ${scope.lastName.use()}`,
});

// Empty collection
const people = person.createMap();

// Pre-populated from a Map
const people = person.createMap(
  new Map([
    ['alice', { firstName: 'Alice', lastName: 'Smith' }],
    ['bob', { firstName: 'Bob', lastName: 'Jones' }],
  ]),
);

// Pre-populated from [key, data] tuples
const people = person.createMap([
  ['alice', { firstName: 'Alice', lastName: 'Smith' }],
  ['bob', { firstName: 'Bob', lastName: 'Jones' }],
]);
```

Each entry in the data argument goes through `.create()` on the template, so all
initialization rules (defaults, derivations, lifecycle hooks) apply normally.

## Adding and updating entries

`.set()` either creates a new instance or updates an existing one:

```ts
// Create new — calls template.create() under the hood
people.set('carol', { firstName: 'Carol', lastName: 'Davis' });

// Update existing — calls $setSnapshot() on the instance
people.set('carol', { firstName: 'Caroline' });

// Create with defaults only
people.set('empty', {});
```

When updating an existing entry, only the provided fields are written. Fields
not in the update object are left unchanged.

## Reading entries

```ts
const alice = people.get('alice'); // ScopeInstance | undefined
alice?.firstName.get(); // 'Alice'
alice?.fullName.get(); // 'Alice Smith'

people.has('alice'); // true
people.has('nobody'); // false
people.size; // 3
```

The instance returned by `.get()` is a live scope instance. You can read fields,
set values, subscribe, and use React hooks on it.

## Removing entries

`.delete()` removes an instance and calls `$destroy()` on it:

```ts
people.delete('alice'); // true — instance destroyed
people.delete('nobody'); // false — key not found
```

`.clear()` removes all instances, calling `$destroy()` on each:

```ts
people.clear(); // all instances destroyed, size is 0
```

Destruction runs lifecycle hooks (`onDestroy`), aborts async derivations, and
cleans up subscriptions. See [Lifecycle hooks](lifecycle.md) for details.

## Iterating

```ts
people.keys(); // ['alice', 'bob'] — array of keys
people.values(); // [aliceInstance, bobInstance] — array of instances
people.entries(); // [['alice', aliceInstance], ['bob', bobInstance]]
```

These methods return fresh arrays on each call. They are snapshots, not live
views.

## Subscribing to key changes

`.subscribe()` fires when the key list changes (instances added or removed). It
does not fire when fields within an existing instance change:

```ts
const unsub = people.subscribe((keys) => {
  console.log('Current keys:', keys);
});

people.set('dave', { firstName: 'Dave', lastName: 'Lee' });
// logs: Current keys: ['alice', 'bob', 'dave']

people.get('alice')!.firstName.set('Alicia');
// does NOT fire — key list didn't change
```

For per-field changes within an instance, use the instance's own `.subscribe()`
or `$subscribe()`.

## React integration

### useKeys()

`useKeys()` returns the current key list and re-renders the component when keys
are added or removed:

```tsx
function PeopleList({ people }) {
  const keys = people.useKeys();
  return (
    <ul>
      {keys.map((key) => (
        <PersonRow key={key} person={people.get(key)!} />
      ))}
    </ul>
  );
}
```

The parent component re-renders when entries are added or removed. Individual
`PersonRow` components only re-render when their own fields change, because they
subscribe to individual field values via `.use()`.

### Per-instance hooks

Pass the instance down to child components and use field-level `.use()`:

```tsx
function PersonRow({ person }) {
  const [firstName, setFirstName] = person.firstName.use();
  const [fullName] = person.fullName.use();
  return (
    <tr>
      <td>
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
      </td>
      <td>{fullName}</td>
    </tr>
  );
}
```

This pattern gives you fine-grained reactivity: changes to one person's name
only re-render that person's row.

## Typed keys

The key type defaults to `string | number`. Narrow it with a type parameter:

```ts
const userMap = person.createMap<number>(); // numeric keys
const nodeMap = person.createMap<string>(); // string keys only
```

The type parameter flows through to `.get()`, `.set()`, `.delete()`, `.keys()`,
and all other methods.

## Lifecycle and cleanup

Each instance in a `ScopeMap` has its own lifecycle. The scope's `onCreate` hook
fires when `.set()` creates a new instance. `onDestroy` fires when `.delete()`
or `.clear()` removes one.

```ts
const tracked = valueScope(
  { name: value<string>() },
  {
    onCreate: ({ scope }) => console.log('created:', scope.name.get()),
    onDestroy: ({ scope }) => console.log('destroyed:', scope.name.get()),
  },
);

const map = tracked.createMap();
map.set('a', { name: 'Alice' }); // logs: created: Alice
map.delete('a'); // logs: destroyed: Alice
map.clear(); // logs onDestroy for each remaining entry
```

Destroying the collection (or letting it be garbage collected) does not
automatically destroy instances. Always call `.clear()` or `.delete()` to
trigger proper cleanup. For per-instance child collections owned by a parent
scope, see
[Refs — Per-instance child collections](refs.md#per-instance-child-collections).
