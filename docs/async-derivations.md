# Async Derivations

When a derivation function is `async`, ValUse automatically manages abort
signals, status tracking, dependency subscriptions, and cleanup. Async
derivations look like regular derivations in the scope definition but unlock
patterns like data fetching, WebSocket streams, and polling.

## Table of contents

- [Basic async derivation](#basic-async-derivation)
- [The derivation context](#the-derivation-context)
- [Abort and re-run](#abort-and-re-run)
- [Status tracking with AsyncState](#status-tracking-with-asyncstate)
- [Intermediate values with set()](#intermediate-values-with-set)
- [Cleanup with onCleanup()](#cleanup-with-oncleanup)
- [Dependency tracking](#dependency-tracking)
- [Seeding with cached data](#seeding-with-cached-data)
- [Long-running derivations](#long-running-derivations)
- [Async utilities](#async-utilities)
- [Sync derivations depending on async](#sync-derivations-depending-on-async)
- [React integration](#react-integration)
- [Error handling](#error-handling)

---

## Basic async derivation

Mark a derivation as `async` and it becomes an async derivation:

```ts
const profileScope = valueScope(
  { userId: value<string>() },
  {
    profile: async ({ scope, signal }) => {
      const id = scope.userId.use();
      const res = await fetch(`/api/users/${id}`, { signal });
      return res.json();
    },
  },
);
```

The derivation runs immediately on instance creation. When `userId` changes, the
previous run is aborted and a new one starts. The return value is stored as the
field's value.

## The derivation context

Every derivation function (sync or async) receives the same context object:

| Property        | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `scope`         | Reactive scope: read other fields via `.use()` / `.get()`                           |
| `signal`        | `AbortSignal` that fires on dep change or destroy                                   |
| `set(value)`    | Push intermediate values before the final `return`                                  |
| `onCleanup(fn)` | Register cleanup for re-run or destroy                                              |
| `deferBy(ms)`   | Abortable + flushable sleep (see [Deferring with deferBy](#deferring-with-deferby)) |
| `previousValue` | The last resolved value (or `undefined`)                                            |

```ts
profile: async ({ scope, signal, set, onCleanup, deferBy, previousValue }) => {
  // ...
};
```

Four of the fields after `scope` (`signal`, `set`, `onCleanup`, `deferBy`) are
async-only and should be ignored in sync derivations. `previousValue` is useful
in both: sync derivations can read the prior return value for patterns like
trend detection (`current > previousValue`) or smoothing. The fields show up on
every derivation's ctx because the type system can't discriminate per-entry
between sync and async slots.

By convention, sync derivations destructure only `({ scope })`:

```ts
unreadCount: ({ scope }) => {
  const notifs = scope.notifications.use() ?? [];
  return notifs.filter((n) => n.ts > scope.lastReadAt.use()).length;
},
```

This convention makes the intent visible at a glance and keeps sync derivations
free of async-only fields they shouldn't be using.

> One upside of the unified context: swapping a derivation from sync to async
> (or back) is a one-keyword change. No context-type annotation to swap, no
> wrapper to add or remove.

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
  isPending: boolean; // setting && !hasValue, "first load, show a spinner"
  isUpdating: boolean; // setting && hasValue, new value computing, keep current on screen
  isError: boolean; // status === 'error'
}
```

`isPending`, `isUpdating`, and `isError` are convenience flags derived from
`status` / `hasValue`. `isPending` is the "first load" check (in flight with
nothing to show yet); `isUpdating` is its complement (in flight with a value
already present, so you can keep the current value on screen and show a subtle
indicator). The two partition the `'setting'` status and are mutually exclusive.
Use `status` directly when you need to distinguish all four states or want
TypeScript to narrow on it.

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
const profile = profileScope.create({ userId: 'alice' });
profile.profile.getAsync();
// { value: undefined, hasValue: false, status: 'setting', error: undefined }
```

After the fetch resolves:

```ts
profile.profile.getAsync();
// { value: { name: 'Alice', ... }, hasValue: true, status: 'set', error: undefined }
```

The `value` field preserves the previous value during re-runs. When `userId`
changes and a new fetch starts, `status` becomes `'setting'` but `value` still
holds the previous profile until the new one arrives. This makes
stale-while-revalidate UIs straightforward.

## Intermediate values with set()

The `set()` function pushes values before the final `return`. This is useful for
optimistic updates, streaming data, and progress reporting:

```ts
profile: async ({ scope, set, signal }) => {
  const id = scope.userId.use();

  // Show cached profile immediately
  const cached = profileCache.get(id);
  if (cached) set(cached);

  // Fetch fresh profile
  const res = await fetch(`/api/users/${id}`, { signal });
  const data = await res.json();

  // Cache for next time
  profileCache.set(id, data);
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

  // This derivation never returns; it pushes values via set()
  // and runs until cleanup
},
```

You can register multiple cleanup functions. They run in registration order. For
scope-level cleanup patterns (timers, event listeners), see
[Lifecycle: Cleanup patterns](lifecycle.md#cleanup-patterns).

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
    const token = scope.authToken.use();   // also tracked, works after await
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
const instance = profileScope.create({
  userId: 'alice',
  profile: cachedProfile, // available via .get() right away
});

instance.profile.get(); // cachedProfile (immediately)
instance.profile.getAsync().status; // 'setting' (fetch in progress)
// ... later ...
instance.profile.get(); // freshProfile (from fetch)
instance.profile.getAsync().status; // 'set'
```

This is the stale-while-revalidate pattern. The UI can render immediately with
the cached data while the fresh data loads in the background. For bulk creation
with pre-seeded data, see [ScopeMap](scope-map.md#creating-a-scopemap).

## Long-running derivations

Since `set()` can push values at any point, putting it inside a loop creates a
long-running process. This is natural for polling, WebSocket streams, or any
open-ended data source:

```ts
const tickerScope = valueScope(
  { symbol: value<string>() },
  {
    price: async ({ scope, set, signal, deferBy }) => {
      const sym = scope.symbol.use();
      while (!signal.aborted) {
        const res = await fetch(`/api/price/${sym}`, { signal });
        const data = await res.json();
        set(data.price);
        await deferBy(1_000);
      }
    },
  },
);
```

When `symbol` changes, the loop's `signal` is aborted, the `while` exits, and a
new loop starts with the new symbol. When the instance is destroyed, the loop
stops automatically.

## Async utilities

`valuse/utils` ships four signal-aware async helpers for use inside async
derivations (or anywhere you have an `AbortSignal`). All of them reject, or
stop, when their `signal` fires, so they compose cleanly with a derivation's
abort-on-rerun lifecycle.

| Helper                                       | Purpose                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `asyncDelay({ ms, signal })`                 | Abortable sleep. Rejects with the abort reason if the signal fires.             |
| `asyncPoll({ ms, signal }, fn)`              | Calls `fn` immediately, then every `ms`, until the signal aborts.               |
| `asyncRetry({ max?, backoff?, signal }, fn)` | Retries `fn` on failure with linear backoff; returns the first success.         |
| `asyncTimeout({ ms, signal }, fn)`           | Runs `fn` with a deadline; rejects with `Timeout` if it doesn't settle in time. |

```ts
import { asyncPoll, asyncRetry, asyncTimeout } from 'valuse/utils';

const inboxScope = valueScope(
  { userId: value<string>() },
  {
    // Poll every 30s; the loop stops automatically when `userId` changes or
    // the instance is destroyed.
    notifications: async ({ scope, set, signal }) => {
      const id = scope.userId.use();
      await asyncPoll({ ms: 30_000, signal }, async () => {
        // Retry the fetch up to 3 times, and give each attempt a 5s ceiling.
        const data = await asyncRetry({ signal, max: 3 }, () =>
          asyncTimeout({ ms: 5000, signal }, async () => {
            const res = await fetch(`/api/notifications/${id}`, { signal });
            return res.json();
          }),
        );
        set(data);
      });
    },
  },
);
```

Notes:

- `asyncRetry`'s `max` is the total number of attempts (including the first) and
  must be `>= 1`; `backoff` (default `1000`ms) is multiplied by the attempt
  number. An aborted signal stops retrying and surfaces the abort reason.
- `asyncTimeout` enforces the deadline even while `fn` is still pending; it does
  not wait for `fn` to finish. Pass the same `signal` into `fn` (e.g. to
  `fetch`) if you also want to cancel the underlying work.

## Deferring with deferBy

`deferBy(ms)` is an abortable, flushable sleep. It returns a Promise that:

- Resolves after `ms` milliseconds.
- Rejects if the derivation's `signal` aborts (dep change or instance
  destroyed).
- Resolves early if `.flush()` is called on the derivation from outside.

The canonical use is in-derivation debounce for search-as-you-type:

```ts
results: async ({ scope, signal, deferBy }) => {
  const q = scope.query.use().trim();
  if (q.length < 2) return [];

  await deferBy(200); // typing again aborts; .flush() expedites

  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  return res.json();
};
```

A new keystroke aborts the pending fetch _before it even fires_. The view can
call `instance.results.flush()` on Enter to short-circuit the wait and run
immediately with whatever the current input is.

`deferBy(ms)` is the same primitive used in
[factory pipes](pipes.md#actor-factory-pipes). One deferral helper, one mental
model, used identically in both places.

## Flushing async derivations

Every async derivation has a `.flush(): Promise<void>` method that **settles the
run to its next output**. It expedites the active `deferBy()` and keeps chasing,
re-expediting any freshly-armed deferral, until the run either:

- **emits a value** via `set()`,
- **completes** (returns or throws), or
- hits a safety cap (1,000 chase iterations) so a degenerate loop that defers
  without ever producing output can't hang flush forever (a `console.warn` flags
  it when reached).

If the derivation isn't currently running, the Promise resolves immediately.

```tsx
function SearchInput({ instance }) {
  const [query, setQuery] = instance.query.use();
  return (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') instance.results.flush(); // fire-and-forget
      }}
    />
  );
}

// Or await when you need a settle signal:
async function submitSearch() {
  await form.results.flush();
  send(form.results.get());
}
```

**Flush expedites deferrals, not arbitrary awaits.** If the derivation is past
its `deferBy()` and waiting on a `fetch()`, `.flush()` has nothing to skip; the
Promise resolves when the fetch resolves (and any `set()` or `return` it
triggers). Flush means "expedite the deferral," not "speed up the network."

**Streaming derivations work too.** A loop with `set()` (see
[Long-running derivations](#long-running-derivations)) never returns, but each
iteration produces an emit. `.flush()` on such a derivation resolves once the
next emit lands, useful for "give me the next value" semantics.

`.flush()` is different from `.recompute()`:

- **`.recompute()`** aborts the current run and starts a fresh one from scratch.
  Any in-flight work is discarded.
- **`.flush()`** expedites the _current_ run, chasing any `deferBy()` calls
  forward until the run produces its next output. The run continues with
  whatever inputs it was already operating on.

Use `.flush()` when the inputs haven't changed and you just want to skip the
deferral. Use `.recompute()` when you want to retry from scratch.

## Sync derivations depending on async

Sync derivations can depend on async ones without knowing they are async.
`.use()` returns `T | undefined`; no promises, no `await`:

```ts
interface FetchResult {
  data: Item[];
  total: number;
}

const tableScope = valueScope(
  {
    search: value(''),
    status: value<'all' | 'active' | 'archived'>('all'),
    page: value(1),
  },
  {
    rows: async ({ scope, signal }) => {
      const params = new URLSearchParams({
        search: scope.search.use(),
        status: scope.status.use(),
        page: String(scope.page.use()),
      });
      const res = await fetch(`/api/items?${params}`, { signal });
      return (await res.json()) as FetchResult;
    },
  },
  {
    isEmpty: ({ scope }) => (scope.rows.use()?.data.length ?? 0) === 0,
    totalPages: ({ scope }) => Math.ceil((scope.rows.use()?.total ?? 0) / 25),
    summary: ({ scope }) => {
      const result = scope.rows.use(); // FetchResult | undefined
      if (!result) return 'Loading…';
      return `${result.data.length} of ${result.total} items`;
    },
  },
);
```

Three layers: filter fields, an async fetch, and sync display derivations that
read the fetch result. Change a dropdown, and the entire pipeline re-evaluates:
`rows` aborts and refetches, then `isEmpty`, `totalPages`, and `summary`
recompute with the new data. The sync derivations don't know `rows` is async;
they call `.use()` the same way they would on any other field.

If you later change `rows` from async to sync (or vice versa), the downstream
derivations don't need to change. Both produce the same `T | undefined` to a
downstream sync derivation.

## React integration

In React, async derivations have two hooks:

```tsx
// Simple: just the value
const [notifications] = inbox.notifications.use(); // T | undefined

// Full: value + async state
const [notifications, state] = inbox.notifications.useAsync(); // [T | undefined, AsyncState<T>]
```

Use the full form for loading and error states:

```tsx
function NotificationList({ inbox }) {
  const [notifications, state] = inbox.notifications.useAsync();

  if (state.isPending) return <Spinner />;
  if (state.isError) return <Error error={state.error} />;
  return <List items={notifications} />;
}
```

The component re-renders on both value changes and status transitions.

## Error handling

When an async derivation throws or its promise rejects, the state transitions to
`'error'`. The previous value is preserved in `state.value`:

```ts
inbox.notifications.getAsync();
// { value: previousNotifications, hasValue: true, status: 'error', error: Error(...) }
```

The derivation does not retry automatically. To retry, either change a tracked
dependency (which triggers a re-run) or call `.recompute()`:

```ts
inbox.notifications.recompute(); // re-runs the async derivation from scratch
```

If the derivation throws synchronously (before any `await`), the behavior is the
same: `status` becomes `'error'` and the error is captured.
