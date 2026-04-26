# Async Derivations

When a derivation function is `async`, ValUse automatically manages abort
signals, status tracking, dependency subscriptions, and cleanup. Async
derivations look like regular derivations in the scope definition but unlock
patterns like data fetching, WebSocket streams, and polling.

## Table of contents

- [Basic async derivation](#basic-async-derivation)
- [The async context](#the-async-context)
- [Abort and re-run](#abort-and-re-run)
- [Status tracking with AsyncState](#status-tracking-with-asyncstate)
- [Intermediate values with set()](#intermediate-values-with-set)
- [Cleanup with onCleanup()](#cleanup-with-oncleanup)
- [Dependency tracking](#dependency-tracking)
- [Seeding with cached data](#seeding-with-cached-data)
- [Long-running derivations](#long-running-derivations)
- [Sync derivations depending on async](#sync-derivations-depending-on-async)
- [React integration](#react-integration)
- [Error handling](#error-handling)

---

## Basic async derivation

Mark a derivation as `async` and it becomes an async derivation:

```ts
const userScope = valueScope({
  userId: value<string>(),

  profile: async ({ scope, signal }) => {
    const id = scope.userId.use();
    const res = await fetch(`/api/users/${id}`, { signal });
    return res.json();
  },
});
```

The derivation runs immediately on instance creation. When `userId` changes, the
previous run is aborted and a new one starts. The return value is stored as the
field's value.

## The async context

Async derivations receive a richer context than sync ones:

| Property        | Description                                        |
| --------------- | -------------------------------------------------- |
| `scope`         | Same scope context as sync derivations             |
| `signal`        | `AbortSignal` that fires on dep change or destroy  |
| `set(value)`    | Push intermediate values before the final `return` |
| `onCleanup(fn)` | Register cleanup for re-run or destroy             |
| `previousValue` | The last resolved value (or `undefined`)           |

```ts
profile: async ({ scope, signal, set, onCleanup, previousValue }) => {
  // ...
};
```

## Abort and re-run

When any tracked dependency changes, ValUse:

1. Aborts the `signal` on the current run
2. Runs all registered `onCleanup` functions
3. Starts a new run with a fresh `signal`

Pass `signal` to any API that supports `AbortSignal` (fetch, EventSource, custom
async work) so in-flight requests are cancelled automatically:

```ts
profile: async ({ scope, signal }) => {
  const id = scope.userId.use();
  const res = await fetch(`/api/users/${id}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
},
```

When the instance is destroyed via `$destroy()`, the signal is also aborted.

## Status tracking with AsyncState

Every async derivation has an `AsyncState<T>` that tracks its lifecycle:

```ts
interface AsyncState<T> {
  value: T | undefined; // the last resolved value
  hasValue: boolean; // true once any value has been produced
  status: 'unset' | 'setting' | 'set' | 'error';
  error: unknown; // the error if status === 'error'
}
```

The status transitions are:

| From      | To        | When                               |
| --------- | --------- | ---------------------------------- |
| `unset`   | `setting` | First run starts                   |
| `setting` | `set`     | Promise resolves or `set()` called |
| `setting` | `error`   | Promise rejects or function throws |
| `set`     | `setting` | Dependency changes, re-run starts  |
| `error`   | `setting` | Dependency changes, re-run starts  |

Read the async state with `.getAsync()`:

```ts
const bob = userScope.create({ userId: 'bob' });
bob.profile.getAsync();
// { value: undefined, hasValue: false, status: 'setting', error: undefined }
```

After the fetch resolves:

```ts
bob.profile.getAsync();
// { value: { name: 'Bob', ... }, hasValue: true, status: 'set', error: undefined }
```

The `value` field preserves the previous value during re-runs. When `userId`
changes and a new fetch starts, `status` becomes `'setting'` but `value` still
holds the previous profile until the new one arrives. This makes
stale-while-revalidate UIs straightforward.

## Intermediate values with set()

The `set()` function pushes values before the final `return`. This is useful for
optimistic updates, streaming data, and progress reporting:

```ts
results: async ({ scope, set, signal }) => {
  const query = scope.query.use();

  // Show cached results immediately
  const cached = cache.get(query);
  if (cached) set(cached);

  // Fetch fresh results
  const res = await fetch(`/api/search?q=${query}`, { signal });
  const data = await res.json();

  // Cache for next time
  cache.set(query, data);
  return data; // replaces the cached value
},
```

Each `set()` call immediately updates the field's value, transitions `status` to
`'set'`, and notifies subscribers. The final `return` does the same. If `return`
produces `undefined`, the last `set()` value is preserved.

## Cleanup with onCleanup()

Register cleanup functions that run when the derivation re-runs or when the
instance is destroyed:

```ts
messages: async ({ scope, set, onCleanup }) => {
  const roomId = scope.roomId.use();
  const ws = new WebSocket(`/ws/rooms/${roomId}`);

  onCleanup(() => ws.close());

  ws.onmessage = (event) => {
    set(JSON.parse(event.data));
  };

  // This derivation never returns — it pushes values via set()
  // and runs until cleanup
},
```

You can register multiple cleanup functions. They run in registration order. For
scope-level cleanup patterns (timers, event listeners), see
[Lifecycle — Cleanup patterns](lifecycle.md#cleanup-patterns).

## Dependency tracking

Unlike sync derivations that use Preact's computed() for automatic tracking,
async derivations use eager subscriptions. Each `.use()` call inside the async
function subscribes to that signal. When any subscribed signal changes, the
derivation aborts and re-runs.

This means `.use()` works anywhere in async derivations, before or after
`await`:

```ts
profile: async ({ scope, signal }) => {
  const id = scope.userId.use();           // tracked
  const data = await fetch(`/api/${id}`, { signal });

  if (data.needsAuth) {
    const token = scope.authToken.use();   // also tracked — works after await
    return fetchWithAuth(data.url, token, { signal });
  }

  return data;
},
```

If `authToken` changes after the `await`, the derivation aborts and re-runs. The
new run will re-evaluate `userId` and `authToken` from the start.

Cycle detection prevents an async derivation from calling `.use()` on itself or
on another async derivation that is currently running.

## Seeding with cached data

Pass a value for an async derivation key in `.create()` to seed it with cached
data. The derivation still runs, but the seeded value is available immediately:

```ts
const bob = userScope.create({
  userId: 'bob',
  profile: cachedProfile, // available via .get() right away
});

bob.profile.get(); // cachedProfile (immediately)
bob.profile.getAsync().status; // 'setting' (fetch in progress)
// ... later ...
bob.profile.get(); // freshProfile (from fetch)
bob.profile.getAsync().status; // 'set'
```

This is the stale-while-revalidate pattern. The UI can render immediately with
the cached data while the fresh data loads in the background. For bulk creation
with pre-seeded data, see [ScopeMap](scope-map.md#creating-a-scopemap).

## Long-running derivations

Since `set()` can push values at any point, putting it inside a loop creates a
long-running process. This is natural for polling, WebSocket streams, or any
open-ended data source:

```ts
const ticker = valueScope({
  symbol: value<string>(),

  price: async ({ scope, set, signal }) => {
    const sym = scope.symbol.use();
    while (!signal.aborted) {
      const res = await fetch(`/api/price/${sym}`, { signal });
      const data = await res.json();
      if (!signal.aborted) set(data.price);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  },
});
```

When `symbol` changes, the loop's `signal` is aborted, the `while` exits, and a
new loop starts with the new symbol. When the instance is destroyed, the loop
stops automatically.

## Sync derivations depending on async

Sync derivations can depend on async ones without knowing they are async.
`.use()` returns `T | undefined`; no promises, no `await`:

```ts
const person = valueScope({
  userId: value<string>(),

  profile: async ({ scope, signal }) => {
    const res = await fetch(`/api/users/${scope.userId.use()}`, { signal });
    return res.json(); // { name: string }
  },

  greeting: ({ scope }) => {
    const profile = scope.profile.use(); // { name: string } | undefined
    return profile ? `Hello, ${profile.name}!` : 'Loading...';
  },
});
```

When `profile` resolves, `greeting` recomputes automatically. If you later
change `profile` from async to sync (or vice versa), `greeting` does not need to
change.

## React integration

In React, async derivations have two hooks:

```tsx
// Simple — just the value
const [profile] = bob.profile.use(); // T | undefined

// Full — value + async state
const [profile, state] = bob.profile.useAsync(); // [T | undefined, AsyncState<T>]
```

Use the full form for loading and error states:

```tsx
function Profile({ person }) {
  const [profile, state] = person.profile.useAsync();

  if (state.status === 'setting' && !state.hasValue) return <Spinner />;
  if (state.status === 'error') return <Error error={state.error} />;
  return <Card data={profile} />;
}
```

The component re-renders on both value changes and status transitions.

## Error handling

When an async derivation throws or its promise rejects, the state transitions to
`'error'`. The previous value is preserved in `state.value`:

```ts
bob.profile.getAsync();
// { value: previousProfile, hasValue: true, status: 'error', error: Error(...) }
```

The derivation does not retry automatically. To retry, either change a tracked
dependency (which triggers a re-run) or call `.recompute()`:

```ts
bob.profile.recompute(); // re-runs the async derivation from scratch
```

If the derivation throws synchronously (before any `await`), the behavior is the
same: `status` becomes `'error'` and the error is captured.
