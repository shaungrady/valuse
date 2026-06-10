# Reactive Values

A `value` is a single piece of reactive state. It wraps a signal with
transforms, custom comparison, subscriptions, and an optional React hook. Every
other reactive type in ValUse (`valueArray`, `valueSet`, `valueMap`,
[scopes](scopes.md)) builds on the same core interface.

## Table of contents

- [Creating values](#creating-values)
- [Reading and writing](#reading-and-writing)
- [Subscribing to changes](#subscribing-to-changes)
- [React integration](#react-integration)
- [Collections](#collections)
- [Transforms with pipe()](#transforms-with-pipe)
- [Custom comparison](#custom-comparison)
- [Pipeline ordering](#pipeline-ordering)
- [Batching writes](#batching-writes)
- [Cleanup](#cleanup)

---

## Creating values

```ts
import { value } from 'valuse';

const userId = value('alice'); // Value<string>, type inferred from default
const unreadCount = value(0); // Value<number>
const profile = value<Profile | null>(); // Value<Profile | null | undefined>, no default
```

When you omit the default, the type becomes `T | undefined` and the initial
value is `undefined`. When you provide a default, the type is exactly `T`.

## Reading and writing

```ts
userId.get(); // 'alice'
userId.set('bob'); // direct value
userId.set((prev) => prev.toUpperCase()); // callback form, receives current value
```

The callback form is useful when the next value depends on the current one. The
callback receives the _output_ type (post-pipe if pipes are present), and should
return the _input_ type.

## Subscribing to changes

`.subscribe()` fires after every write that produces a new value. It receives
both the new value and the previous value:

```ts
const unsub = userId.subscribe((value, previous) => {
  console.log(`${previous} → ${value}`);
});

userId.set('carol'); // logs: alice → carol
unsub(); // stop listening
```

Subscribers do not fire on the initial value, only on subsequent changes. If a
write produces the same value (by identity or custom comparator), subscribers
are not notified.

## React integration

Import `valuse/react` once in your app to enable `.use()` hooks on all reactive
types:

```ts
import 'valuse/react';
```

Then use `.use()` in any component. It returns a `[value, setter]` tuple:

```tsx
function FilterInput() {
  const [filter, setFilter] = filterValue.use();
  return <input value={filter} onChange={(e) => setFilter(e.target.value)} />;
}
```

Under the hood, `.use()` calls React's `useSyncExternalStore` for
concurrent-safe subscriptions. The component only re-renders when the value
actually changes.

Without the React import, `.use()` still works but returns a non-reactive
snapshot (useful for testing or SSR).

## Collections

ValUse provides reactive versions of Array, Set, and Map. They share the same
core interface (`.get()`, `.set()`, `.subscribe()`, `.use()`) with
collection-specific methods on top.

### valueArray

```ts
import { valueArray } from 'valuse';

const messages = valueArray(['hello', 'world', 'welcome']);
messages.get(); // readonly ['hello', 'world', 'welcome'], frozen
messages.get(0); // 'hello'
messages.get(-1); // 'welcome', negative indices count from end

messages.push('new');
messages.pop(); // 'new'
messages.unshift('first');
messages.shift(); // 'first'
messages.splice(1, 1, 'replaced'); // remove 1 at index 1, insert 'replaced'
messages.filter((s) => s !== 'replaced');
messages.sort();
messages.reverse();
messages.swap(0, 1); // swap indices 0 and 1
messages.map((s) => s.toUpperCase());
```

The array returned by `.get()` is always frozen. Mutations go through the
methods above, never through direct array access.

In React, `.use()` returns `[array, setter]`. Use `.use(index)` for per-index
subscriptions:

```tsx
const [allMessages, setMessages] = messages.use();
const [first, setFirst] = messages.use(0); // only re-renders when index 0 changes
```

Per-element transforms with `pipeElement()`:

```ts
const tags = valueArray<string>().pipeElement((s) => s.trim().toLowerCase());
tags.push(' Important '); // stored as 'important'
```

Per-element comparison with `compareElementsUsing()`:

```ts
const notifications = valueArray<Notification>().compareElementsUsing(
  (a, b) => a.id === b.id,
);
```

### valueSet

```ts
import { valueSet } from 'valuse';

const labels = valueSet(['inbox', 'important']);
labels.add('starred');
labels.delete('inbox');
labels.has('starred'); // true
labels.get(); // Set { 'important', 'starred' }
labels.values(); // ['important', 'starred']
labels.size; // 2
labels.clear();
```

Draft-based mutations for complex updates:

```ts
labels.set((draft) => {
  draft.add('archived');
  draft.delete('important');
});
```

The draft is a lightweight proxy that records adds and deletes, then produces a
new Set only if something changed. If the mutator makes no effective changes,
the original Set is returned and subscribers are not notified.

### valueMap

```ts
import { valueMap } from 'valuse';

const readTimestamps = valueMap<string, number>([
  ['alice', 1717776000],
  ['bob', 1717780000],
]);
readTimestamps.get(); // Map { 'alice' => 1717776000, 'bob' => 1717780000 }
readTimestamps.get('alice'); // 1717776000
readTimestamps.has('bob'); // true
readTimestamps.delete('bob');
readTimestamps.keys(); // ['alice']
readTimestamps.values(); // [1717776000]
readTimestamps.entries(); // [['alice', 1717776000]]
readTimestamps.size; // 1
readTimestamps.clear();
```

Draft-based mutations work the same as `valueSet`:

```ts
readTimestamps.set((draft) => {
  draft.set('carol', Date.now());
  draft.delete('alice');
});
```

Per-key React subscriptions prevent unnecessary re-renders:

```tsx
const [aliceTs, setAlice] = readTimestamps.use('alice'); // only re-renders for alice
const keys = readTimestamps.useKeys(); // only re-renders when keys are added/removed
```

## Transforms with pipe()

Chain `.pipe()` to transform values on every `.set()`. Pipes run left to right
before the value is stored:

```ts
const email = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase());

email.set('  Alice@Example.Com  ');
email.get(); // 'alice@example.com'
```

Pipes can change the type. The input type (accepted by `.set()`) stays the same,
but the output type (returned by `.get()`) follows the last pipe:

```ts
const parsed = value<string>('0').pipe((v) => parseInt(v));
parsed.set('42'); // accepts string
parsed.get(); // returns number: 42
```

Chained type changes compose naturally:

```ts
const hasContent = value<string>('')
  .pipe((v) => v.trim()) // string -> string
  .pipe((v) => v.length) // string -> number
  .pipe((v) => v > 0); // number -> boolean

hasContent.set('hello');
hasContent.get(); // true
```

For stateful transforms like debounce and throttle, see
[Factory pipes](pipes.md#factory-pipes). For the full pipeline ordering (pipes +
comparison), see [Pipeline ordering](pipes.md#pipeline-ordering).

## Custom comparison

By default, values notify subscribers when the new value is not `===` to the
previous one. Override with `.compareUsing()`:

```ts
const notification = value<Notification>({ id: 1, body: 'Hello' }).compareUsing(
  (a, b) => a.id === b.id,
);

notification.set({ id: 1, body: 'Updated' }); // no notification, same id
notification.set({ id: 2, body: 'New' }); // notifies, different id
```

The comparator receives the post-pipe values (after all transforms have run).

`valueSet` and `valueMap` also support `.compareUsing()` for whole-collection
comparison.

## Pipeline ordering

When a value has both pipes and a custom comparator, the order is:

1. **`.set(raw)`**: raw input enters.
2. **Pipe chain**: transforms run left to right.
3. **`.compareUsing()`**: compared against current stored value.
4. **Write**: if different, the signal updates and subscribers fire.

This means comparison always runs on the _transformed_ value, not the raw input.

## Batching writes

Multiple synchronous writes to different values normally fire subscribers once
per write. Use `batchSets` to group them:

```ts
import { batchSets } from 'valuse';

batchSets(() => {
  userId.set('bob');
  lastReadAt.set(Date.now());
  filter.set('unread');
});
// Subscribers notified once, not three times
```

Batching is handled by Preact Signals under the hood.
[Derivations](derivations.md) that depend on multiple batched values recompute
once with all new values, not once per intermediate state.

## Cleanup

Standalone values (outside [scopes](scopes.md)) manage their own subscriptions.
Call `.destroy()` to dispose all active subscriptions and factory pipe cleanups:

```ts
const pollCount = value(0);
pollCount.subscribe((v) => console.log(v));
pollCount.destroy(); // stops all listeners, cleans up factory pipes
```

After `.destroy()`, the value is still readable but will no longer notify
subscribers. For values inside scopes, cleanup is handled automatically by
`$destroy()`.
