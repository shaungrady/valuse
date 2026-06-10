# Derivations

Derivations are functions in a [derivation layer](scopes.md#derivation-layers)
that compute values from other fields. They are the reactive glue that keeps
derived state in sync automatically. When a dependency changes, the derivation
re-runs and its subscribers are notified.

For async derivations (fetching data, WebSockets, polling), see
[Async Derivations](async-derivations.md).

## Table of contents

- [Basic derivations](#basic-derivations)
- [Tracked vs untracked reads](#tracked-vs-untracked-reads)
- [The scope context](#the-scope-context)
- [Depending on other derivations](#depending-on-other-derivations)
- [Derivations over collections](#derivations-over-collections)
- [Derivations across nested objects](#derivations-across-nested-objects)
- [Constant derivations](#constant-derivations)
- [Manual recompute](#manual-recompute)
- [React integration](#react-integration)

---

## Basic derivations

A derivation is a non-async function in a derivation layer (any argument to
`valueScope()` between the field layer and the optional config layer). It
receives a context object with a `scope` property for reading other fields:

```ts
const tableScope = valueScope(
  {
    search: value(''),
    status: value<'all' | 'active' | 'archived'>('all'),
    page: value(1),
  },
  {
    activeFilterCount: ({ scope }) => {
      let count = 0;
      if (scope.search.use() !== '') count++;
      if (scope.status.use() !== 'all') count++;
      return count;
    },
  },
);

const table = tableScope.create();
table.activeFilterCount.get(); // 0

table.search.set('overdue');
table.activeFilterCount.get(); // 1

table.status.set('archived');
table.activeFilterCount.get(); // 2
```

The `scope` parameter is contextually typed from the field layer. No manual type
annotation is required.

Derivations are read-only. They have `.get()`, `.use()`, `.subscribe()`, and
`.recompute()`, but no `.set()`.

## Tracked vs untracked reads

Inside a derivation, each field on the scope context has two read methods:

| Method   | Behavior                                                    |
| -------- | ----------------------------------------------------------- |
| `.use()` | **Tracked read.** The derivation re-runs when this changes. |
| `.get()` | **Untracked read.** Current value, no dependency created.   |

```ts
const inboxScope = valueScope(
  {
    filter: value('all'),
    locale: value('en'),
  },
  {
    filterLabel: ({ scope }) =>
      localize(scope.filter.use(), scope.locale.get()),
    //                                             ^^^^                  ^^^^
    //                                    tracked, re-runs       untracked, reads once
  },
);
```

When `filter` changes, `filterLabel` re-runs. When `locale` changes,
`filterLabel` does not re-run (but if something else triggers a re-run, it will
read the current `locale`).

This distinction matters for performance. Track the dependencies that should
trigger recomputation, and use untracked reads for values you only need at
computation time.

## The scope context

The derivation function receives `{ scope }` where `scope` mirrors the instance
tree structure. Every reactive field, ref, and nested object is accessible:

```ts
const cartScope = valueScope(
  {
    items: valueArray<{ price: number; qty: number }>(),
    taxRate: value(0.08),
  },
  {
    subtotal: ({ scope }) =>
      scope.items.use().reduce((sum, item) => sum + item.price * item.qty, 0),
  },
  {
    total: ({ scope }) => {
      const sub = scope.subtotal.use();
      const tax = scope.taxRate.use();
      return sub * (1 + tax);
    },
  },
);
```

`total` reads `subtotal`, so it lives in a later derivation layer.

The scope context is built once per instance and reused across all derivation
runs. It is a lightweight proxy, not a copy of the instance. Derivations can
also read through [refs](refs.md#reactivity-through-refs); reactivity flows
across scope boundaries seamlessly.

## Depending on other derivations

For one derivation to depend on another, declare the dependency in an earlier
derivation layer. Within a single layer, siblings are not visible to one
another:

```ts
const inboxScope = valueScope(
  {
    userId: value<string>(),
    lastReadAt: value<number>(0),
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
      return notifs.filter((n: { ts: number }) => n.ts > readAt).length;
    },
  },
  {
    badge: ({ scope }) => {
      const count = scope.unreadCount.use();
      return count > 99 ? '99+' : String(count);
    },
    hasUnread: ({ scope }) => scope.unreadCount.use() > 0,
  },
);
```

Four layers, each building on the ones before it. When `lastReadAt` changes:

1. `unreadCount` recomputes (depends on `lastReadAt`)
2. `badge` and `hasUnread` recompute (depend on `unreadCount`)

When `userId` changes, `notifications` aborts and refetches, which cascades
through all three downstream layers. The sync derivations read the async
`notifications` via `.use()` without any special handling; see
[Async Derivations: Sync depending on async](async-derivations.md#sync-derivations-depending-on-async).

Because each derivation layer can only read earlier layers, the dependency graph
flows strictly left to right. Circular references between derivations are
structurally impossible: there is no syntax that would allow `A` to read `B`
while `B` reads `A`.

## Derivations over collections

Derivations work with all collection types. Use `.use()` on the collection to
track the whole collection, or `.use()` on individual elements if the collection
supports it:

```ts
const portfolioScope = valueScope(
  {
    holdings: valueMap<string, number>(),
    watchlist: valueSet<string>(),
    recentTrades: valueArray<{ symbol: string; amount: number }>(),
  },
  {
    totalValue: ({ scope }) => {
      const values = [...scope.holdings.use().values()];
      return values.reduce((a, b) => a + b, 0);
    },
    watchlistSize: ({ scope }) => scope.watchlist.use().size,
    tradeCount: ({ scope }) => scope.recentTrades.use().length,
  },
);
```

Any change to the collection (adding, removing, or updating entries) triggers
re-computation of derivations that called `.use()` on it.

## Derivations across nested objects

Derivations can read from any field in the scope, regardless of nesting depth:

```ts
const cartScope = valueScope(
  {
    customerName: value<string>(),
    shipping: {
      method: value<string>('standard'),
      cost: value(0),
    },
  },
  {
    summary: ({ scope }) =>
      `${scope.customerName.use()} via ${scope.shipping.method.use()} ($${scope.shipping.cost.use()})`,
  },
);
```

The scope context mirrors the definition structure, so nested objects are
accessed through dot-path navigation on the scope object.

## Constant derivations

A derivation with zero `.use()` calls is a constant. It runs exactly once during
instance creation and never recomputes:

```ts
const inboxScope = valueScope(
  { userId: value<string>() },
  {
    endpoint: ({ scope }) => `/api/notifications/${scope.userId.get()}`, // untracked
  },
);
```

Constants are useful for computed configuration that depends on initial values
but should not change. If you later need it to update, switch `.get()` to
`.use()`.

## Manual recompute

Call `.recompute()` on any derivation to force a re-run, even if no tracked
dependencies changed. This is useful for derivations that use only `.get()`
(untracked reads) or that depend on external state:

```ts
inbox.unreadCount.recompute(); // re-run this one derivation
inbox.$recompute(); // re-run all derivations on the instance
```

Recomputation follows the same rules as automatic recomputation. If the
recomputed value is the same as the current value, subscribers are not notified.
For async derivations, `.recompute()` aborts the current run and starts fresh;
see [Async Derivations](async-derivations.md#error-handling).

`.flush()` is a different operation: it expedites in-flight deferred work (e.g.,
`deferBy()` in an async derivation) rather than restarting the run. On sync
derivations `.flush()` is a no-op since sync derivations have no deferred state
to expedite. See
[Flushing async derivations](async-derivations.md#flushing-async-derivations).

## React integration

Derivations support `.use()` in React components, just like values. The
difference is that derivations return a single-element tuple (no setter):

```tsx
function BadgeCount({ inbox }) {
  const [badge] = inbox.badge.use();
  return <span className="badge">{badge}</span>;
}
```

The component re-renders only when the derivation's output changes. If multiple
upstream values change but the derived result stays the same, there is no
re-render.

For async derivations with loading states, see
[Async Derivations: React integration](async-derivations.md#react-integration).
