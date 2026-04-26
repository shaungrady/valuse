# Persistence

`withPersistence` syncs a scope instance to a storage backend. Hydrate from
storage on create, write back on change, and (where the adapter supports it)
pick up changes from other tabs in real time.

```ts
import { valueScope, value } from 'valuse';
import { withPersistence, localStorageAdapter } from 'valuse/middleware';

const prefs = valueScope({
  theme: value<'light' | 'dark'>(),
  fontSize: value<number>(),
});

const persistedPrefs = withPersistence(prefs, {
  key: 'user-prefs',
  adapter: localStorageAdapter,
});

const instance = persistedPrefs.create({ theme: 'light', fontSize: 14 });
// If 'user-prefs' exists in localStorage, stored values override the input.
```

## Table of contents

- [How it works](#how-it-works)
- [Options](#options)
- [Shipped adapters](#shipped-adapters)
  - [localStorageAdapter](#localstorageadapter)
  - [sessionStorageAdapter](#sessionstorageadapter)
  - [indexedDBAdapter](#indexeddbadapter)
- [Custom adapters](#custom-adapters)
- [Field filtering](#field-filtering)
- [Custom serialization](#custom-serialization)
- [Throttled writes](#throttled-writes)
- [Cross-tab sync](#cross-tab-sync)
- [Lifecycle](#lifecycle)
- [SSR safety](#ssr-safety)

---

## How it works

`withPersistence` wraps a `ScopeTemplate` and layers three things onto its
lifecycle:

1. **`onCreate`** reads from the adapter. If data exists, the middleware calls
   `$setSnapshot()` to merge it over the `create()` input — stored values win.
2. **`onChange`** serializes the selected fields and writes them back through
   the adapter. If `throttle` is set, the write is debounced.
3. **`onDestroy`** flushes any pending throttled write and tears down the
   cross-tab subscription (if the adapter has one).

Hydration writes are suppressed — when `$setSnapshot` fires during a read
response, the resulting `onChange` sees a flag and skips the write-back, so you
don't immediately echo the stored state back to storage.

## Options

```ts
interface PersistenceOptions {
  /** Storage key. Required. */
  key: string;

  /** Storage adapter. Required. */
  adapter: PersistenceAdapter;

  /**
   * Which fields to persist. Default: all fields in the snapshot.
   * Sync derivations are skipped unless explicitly listed.
   */
  fields?: string[];

  /** Custom serializer. Default: JSON.stringify. */
  serialize?: (snapshot: Record<string, unknown>) => string;

  /** Custom deserializer. Default: JSON.parse. */
  deserialize?: (raw: string) => Record<string, unknown>;

  /**
   * Throttle writes to storage in ms. Default: 0 (write on every change).
   */
  throttle?: number;
}
```

## Shipped adapters

### localStorageAdapter

Synchronous. SSR-safe: reads return `null` and writes are no-ops when
`localStorage` isn't available. Subscribes to the `storage` event so changes
made in another tab are reflected in your instance without a refresh.

```ts
import { localStorageAdapter } from 'valuse/middleware';

withPersistence(scope, {
  key: 'settings',
  adapter: localStorageAdapter,
});
```

### sessionStorageAdapter

Same shape as `localStorageAdapter` but scoped to the tab. No cross-tab sync.
SSR-safe.

```ts
import { sessionStorageAdapter } from 'valuse/middleware';

withPersistence(scope, {
  key: 'wizard-step',
  adapter: sessionStorageAdapter,
});
```

### indexedDBAdapter

Async. Use it for larger payloads, or when you want to keep the main thread free
from the synchronous write cost of `localStorage`. The adapter creates the
database and object store on first use.

```ts
import { indexedDBAdapter } from 'valuse/middleware';

withPersistence(scope, {
  key: 'large-dataset',
  adapter: indexedDBAdapter({
    dbName: 'my-app',
    storeName: 'state', // optional, defaults to 'valuse'
  }),
});
```

Because reads are asynchronous, the instance is created with your `create()`
input first. Once the read resolves, the stored values are merged in via
`$setSnapshot`. Any code that runs synchronously right after `create()` will see
the input values, not the stored ones.

No `subscribe` — IndexedDB doesn't emit change events across contexts.

## Custom adapters

The adapter interface is intentionally minimal. URL search params, cookies, a
REST endpoint, a WebSocket — anything that can round-trip a string fits:

```ts
import type { PersistenceAdapter } from 'valuse/middleware';

const urlParamsAdapter: PersistenceAdapter = {
  read: (key) => new URLSearchParams(location.search).get(key),
  write: (key, data) => {
    const url = new URL(location.href);
    url.searchParams.set(key, data);
    history.replaceState(null, '', url);
  },
  remove: (key) => {
    const url = new URL(location.href);
    url.searchParams.delete(key);
    history.replaceState(null, '', url);
  },
};
```

Adapter methods may be sync or return `Promise`s — the middleware handles both.

## Field filtering

By default every field in `$getSnapshot()` is persisted. Pass `fields` to narrow
it — useful for skipping large derived blobs or ephemeral UI state:

```ts
withPersistence(scope, {
  key: 'settings',
  adapter: localStorageAdapter,
  fields: ['theme', 'fontSize'], // skip everything else
});
```

Derivations aren't persisted by default because they recompute on hydration. You
can include an async derivation key in `fields` to seed its last-known value
while the derivation re-runs, but the default is to skip them.

## Custom serialization

`JSON.stringify` / `JSON.parse` can't round-trip `Date`, `Map`, `Set`, or typed
arrays. Override `serialize` / `deserialize` when that matters:

```ts
withPersistence(scope, {
  key: 'settings',
  adapter: localStorageAdapter,
  serialize: (snapshot) =>
    JSON.stringify(snapshot, (_k, v) =>
      v instanceof Date ? { __date: v.toISOString() } : v,
    ),
  deserialize: (raw) =>
    JSON.parse(raw, (_k, v) =>
      v && typeof v === 'object' && '__date' in v ? new Date(v.__date) : v,
    ) as Record<string, unknown>,
});
```

## Throttled writes

`localStorage` writes are synchronous and block the main thread. On rapid
updates — dragging a slider, typing in an input — the write cost adds up.
`throttle` collapses bursts of changes into at most one write per window:

```ts
withPersistence(scope, {
  key: 'draft',
  adapter: localStorageAdapter,
  throttle: 500, // at most one write every 500ms
});
```

The trailing write always fires. On `$destroy`, any pending throttled write is
flushed synchronously so you don't lose state when the instance tears down.

## Cross-tab sync

When the adapter provides `subscribe`, the middleware wires it up. For
`localStorageAdapter`, that means a tab writing to the same key triggers
`$setSnapshot` on your instance, and every subscriber fires — per-field
`.subscribe()`, whole-scope `$subscribe()`, derivations that `.use()` the field,
and React components via `.use()`. The hydration flag prevents the update from
bouncing back out as a write.

```ts
// Tab A
settingsA.theme.set('dark');

// Tab B — a few ms later
settingsB.theme.get(); // 'dark'
```

```tsx
// Tab B — a React component that reads theme via .use()
// re-renders automatically when Tab A writes.
function ThemeLabel({ settings }) {
  const [theme] = settings.theme.use();
  return <span>{theme}</span>;
}
```

## Lifecycle

| Hook        | What happens                                                  |
| ----------- | ------------------------------------------------------------- |
| `onCreate`  | Read from adapter; if present, `$setSnapshot` over the input. |
| `onChange`  | Write selected fields to adapter (throttled if configured).   |
| `onDestroy` | Flush pending write, unsubscribe from cross-tab events.       |
| `DISPATCH`  | (cross-tab) External write — hydrate via `$setSnapshot`.      |

`withPersistence` never removes the stored data — `$destroy` leaves it in place
so the next instance can hydrate.

## SSR safety

`localStorageAdapter`, `sessionStorageAdapter`, and `indexedDBAdapter` all
return `null` on read and no-op on write when their backing API is unavailable.
You can apply `withPersistence` unconditionally in code that runs on both server
and client — the server just sees "no stored data."
