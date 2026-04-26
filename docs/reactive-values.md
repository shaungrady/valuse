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

const name = value('Alice'); // Value<string> — type inferred from default
const count = value(0); // Value<number>
const user = value<User | null>(); // Value<User | null | undefined> — no default
```

When you omit the default, the type becomes `T | undefined` and the initial
value is `undefined`. When you provide a default, the type is exactly `T`.

## Reading and writing

```ts
name.get(); // 'Alice'
name.set('Bob'); // direct value
name.set((prev) => prev.toUpperCase()); // callback form — receives current value
```

The callback form is useful when the next value depends on the current one. The
callback receives the _output_ type (post-pipe if pipes are present), and should
return the _input_ type.

## Subscribing to changes

`.subscribe()` fires after every write that produces a new value. It receives
both the new value and the previous value:

```ts
const unsub = name.subscribe((value, previous) => {
  console.log(`${previous} → ${value}`);
});

name.set('Charlie'); // logs: Alice → Charlie
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
function NameInput() {
  const [currentName, setName] = name.use();
  return (
    <input value={currentName} onChange={(e) => setName(e.target.value)} />
  );
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

const items = valueArray(['a', 'b', 'c']);
items.get(); // readonly ['a', 'b', 'c'] — frozen
items.get(0); // 'a'
items.get(-1); // 'c' — negative indices count from end

items.push('d');
items.pop(); // 'd'
items.unshift('z');
items.shift(); // 'z'
items.splice(1, 1, 'x'); // remove 1 at index 1, insert 'x'
items.filter((s) => s !== 'x');
items.sort();
items.reverse();
items.swap(0, 1); // swap indices 0 and 1
items.map((s) => s.toUpperCase());
```

The array returned by `.get()` is always frozen. Mutations go through the
methods above, never through direct array access.

In React, `.use()` returns `[array, setter]`. Use `.use(index)` for per-index
subscriptions:

```tsx
const [allItems, setItems] = items.use();
const [first, setFirst] = items.use(0); // only re-renders when index 0 changes
```

Per-element transforms with `pipeElement()`:

```ts
const names = valueArray<string>().pipeElement((s) => s.trim().toLowerCase());
names.push(' Hello '); // stored as 'hello'
```

Per-element comparison with `compareElementsUsing()`:

```ts
const users = valueArray<User>().compareElementsUsing((a, b) => a.id === b.id);
```

### valueSet

```ts
import { valueSet } from 'valuse';

const tags = valueSet(['admin', 'active']);
tags.add('editor');
tags.delete('admin');
tags.has('editor'); // true
tags.get(); // Set { 'active', 'editor' }
tags.values(); // ['active', 'editor']
tags.size; // 2
tags.clear();
```

Draft-based mutations for complex updates:

```ts
tags.set((draft) => {
  draft.add('viewer');
  draft.delete('active');
});
```

The draft is a lightweight proxy that records adds and deletes, then produces a
new Set only if something changed. If the mutator makes no effective changes,
the original Set is returned and subscribers are not notified.

### valueMap

```ts
import { valueMap } from 'valuse';

const scores = valueMap<string, number>([
  ['alice', 95],
  ['bob', 82],
]);
scores.get(); // Map { 'alice' => 95, 'bob' => 82 }
scores.get('alice'); // 95
scores.has('bob'); // true
scores.delete('bob');
scores.keys(); // ['alice']
scores.values(); // [95]
scores.entries(); // [['alice', 95]]
scores.size; // 1
scores.clear();
```

Draft-based mutations work the same as `valueSet`:

```ts
scores.set((draft) => {
  draft.set('carol', 91);
  draft.delete('alice');
});
```

Per-key React subscriptions prevent unnecessary re-renders:

```tsx
const [aliceScore, setAlice] = scores.use('alice'); // only re-renders for alice
const keys = scores.useKeys(); // only re-renders when keys are added/removed
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
const flag = value<string>('')
  .pipe((v) => v.trim()) // string -> string
  .pipe((v) => v.length) // string -> number
  .pipe((v) => v > 0); // number -> boolean

flag.set('hello');
flag.get(); // true
```

For stateful transforms like debounce and throttle, see
[Factory pipes](pipes.md#factory-pipes). For the full pipeline ordering (pipes +
comparison), see [Pipeline ordering](pipes.md#pipeline-ordering).

## Custom comparison

By default, values notify subscribers when the new value is not `===` to the
previous one. Override with `.compareUsing()`:

```ts
const user = value<User>({ id: 1, name: 'Alice' }).compareUsing(
  (a, b) => a.id === b.id,
);

user.set({ id: 1, name: 'Alicia' }); // no notification — same id
user.set({ id: 2, name: 'Bob' }); // notifies — different id
```

The comparator receives the post-pipe values (after all transforms have run).

`valueSet` and `valueMap` also support `.compareUsing()` for whole-collection
comparison.

## Pipeline ordering

When a value has both pipes and a custom comparator, the order is:

1. **`.set(raw)`** — raw input enters
2. **Pipe chain** — transforms run left to right
3. **`.compareUsing()`** — compared against current stored value
4. **Write** — if different, the signal updates and subscribers fire

This means comparison always runs on the _transformed_ value, not the raw input.

## Batching writes

Multiple synchronous writes to different values normally fire subscribers once
per write. Use `batchSets` to group them:

```ts
import { batchSets } from 'valuse';

batchSets(() => {
  firstName.set('Bob');
  lastName.set('Jones');
  age.set(30);
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
const count = value(0);
count.subscribe((v) => console.log(v));
count.destroy(); // stops all listeners, cleans up factory pipes
```

After `.destroy()`, the value is still readable but will no longer notify
subscribers. For values inside scopes, cleanup is handled automatically by
`$destroy()`.
