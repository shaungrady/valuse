# ValUse vs Valtio

Valtio gives you proxy-based state: mutate a plain object and subscribers react.
It has the simplest mutation API of any state library. For straightforward state
needs, nothing is easier to learn or quicker to write. The tradeoff becomes
visible as requirements grow: Valtio provides no built-in derivation caching, no
lifecycle hooks, no async primitives, and no undo/redo. Adding those means
writing the same imperative code you would without a library.

Both implementations build the same stock portfolio: holdings with symbol,
shares, costBasis, an async price poll, derived gain/loss metrics, per-field
undo/redo, and a shared refresh rate.

## Table of contents

- [Model definition](#model-definition)
- [Derived values](#derived-values)
- [Async polling](#async-polling)
- [Undo / redo](#undo--redo)
- [Shared config](#shared-config)
- [React components](#react-components)
- [The full picture](#the-full-picture)

---

## Model definition

**ValUse** defines the holding as layered declarations with history middleware:

```ts
export const holdingScope = withHistory(
  valueScope(
    { symbol: value<string>(), shares: value<number>(0), /* ... */ },
    { price: async ({ scope, set, signal, deferBy }) => { /* ... */ } },
    { marketValue: /* ... */, gainLoss: /* ... */ },
    { isUp: /* ... */ },
  ),
  { maxDepth: 50, fields: ['shares', 'costBasis'] },
);
```

**Valtio** creates a proxy with data, history arrays, and an abort controller:

```ts
export function createHolding(init: {
  symbol: string;
  shares: number;
  costBasis: number;
}): HoldingState {
  return proxy<HoldingState>({
    data: { ...init, price: undefined },
    past: [],
    future: [],
    controller: undefined,
  });
}
```

Valtio's setup is minimal: `proxy()` makes the object reactive, and that is all
the library does. Everything else (derivations, history, polling) is your code.
This simplicity is both the appeal and the limitation.

---

## Derived values

**ValUse** derivations are reactive and cached:

```ts
marketValue: ({ scope }) => {
  const price = scope.price.use();
  return price != null ? scope.shares.use() * price : undefined;
},
```

**Valtio** computes on demand via a plain function:

```ts
export function getDerived(state: HoldingState) {
  const { price, shares, costBasis } = state.data;
  if (price == null) {
    return {
      marketValue: undefined,
      gainLoss: undefined,
      gainLossPercent: undefined,
      isUp: undefined,
    };
  }
  const marketValue = shares * price;
  const gainLoss = (price - costBasis) * shares;
  const gainLossPercent =
    costBasis === 0 ? undefined : ((price - costBasis) / costBasis) * 100;
  return { marketValue, gainLoss, gainLossPercent, isUp: gainLoss >= 0 };
}
```

No caching, no dependency tracking. The function runs every time you call it.
For a small number of holdings this is negligible. For large collections or
expensive derivations, it becomes wasteful.

Valtio does have `derive()` from `valtio/utils`, but it operates on the store
level (not per entity) and does not compose into a reusable model definition.

---

## Async polling

**ValUse** treats the poll as an async derivation:

```ts
price: async ({ scope, set, signal, deferBy }) => {
  while (!signal.aborted) {
    const res = await fetch(`/api/quote/${scope.symbol.use()}`, { signal });
    set((await res.json()).price as number);
    await deferBy(scope.refreshRate.use());
  }
},
```

**Valtio** manages polling imperatively with a manual AbortController:

```ts
export function startPolling(state: HoldingState) {
  stopPolling(state);
  const controller = new AbortController();
  // ref() prevents Valtio from proxying the controller
  // (private #signal fields break under proxies)
  state.controller = ref(controller);
  const { signal } = controller;

  (async () => {
    while (!signal.aborted) {
      try {
        const res = await fetch(`/api/quote/${state.data.symbol}`, { signal });
        if (signal.aborted) break;
        state.data.price = (await res.json()).price as number;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, refreshConfig.rateMs);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      } catch {
        break;
      }
    }
  })();
}
```

Note the `ref()` wrapper on the AbortController. Valtio proxies nested objects
by default, but `AbortController` has private `#signal` fields that break under
proxies. This is a real-world edge case that surprises new users. ValUse's
signal-based state does not have this issue because it does not wrap values in
proxies.

The mutation inside the loop (`state.data.price = ...`) is clean, though.
Valtio's write ergonomics are excellent. You just assign.

---

## Undo / redo

**ValUse** uses middleware:

```ts
export const holdingScope = withHistory(
  valueScope({
    /* ... */
  }),
  {
    maxDepth: 50,
    fields: ['shares', 'costBasis'],
  },
);

holding.$undo();
holding.$redo();
```

**Valtio** builds a manual history stack with snapshot/restore functions:

```ts
function pushHistory(state: HoldingState) {
  state.past.push(historySnap(state.data));
  if (state.past.length > 50) state.past.shift();
  state.future.length = 0;
}

export function setShares(state: HoldingState, shares: number) {
  pushHistory(state);
  state.data.shares = shares;
}

export function undo(state: HoldingState) {
  if (state.past.length === 0) return;
  state.future.unshift(historySnap(state.data));
  const prev = state.past.pop()!;
  state.data.shares = prev.shares;
  state.data.costBasis = prev.costBasis;
}
```

Straightforward, but every setter that should be undoable must call
`pushHistory()`. The mutation side is clean (just assign to properties), but the
undo/redo logic is manual and repetitive.

Valtio has `proxyWithHistory` in `valtio/utils`, which provides undo/redo for
the entire proxy. It snapshots the whole object on every change, which is
simpler but less selective than ValUse's per-field tracking.

---

## Shared config

**ValUse:**

```ts
export const refreshRateMs = value<number>(5_000);
// In scope definition:
refreshRate: valueRef(refreshRateMs),
```

**Valtio:**

```ts
export const refreshConfig = proxy({ rateMs: 5_000 });
```

Both are simple. Valtio's approach is arguably simpler: it is just another proxy
that anyone can read or mutate. No special API needed.

---

## React components

**ValUse** uses per-field hooks:

```tsx
function HoldingRow({ id }: { id: string }) {
  const holding = holdings.get(id)!;
  const [symbol] = holding.symbol.use();
  const [shares, setShares] = holding.shares.use();
  // ...
  return (
    <tr>
      {/* ... */}
      <td>
        <button onClick={holding.$undo}>Undo</button>
        <button onClick={holding.$redo}>Redo</button>
      </td>
    </tr>
  );
}
```

**Valtio** uses `useSnapshot()` for reading and direct mutation for writing:

```tsx
function HoldingRow({ state }: { state: HoldingState }) {
  const snap = useSnapshot(state);
  const { symbol, shares, costBasis } = snap.data;
  const derived = getDerived(state);

  return (
    <tr
      className={
        derived.isUp ? 'gain'
        : derived.isUp === false ?
          'loss'
        : ''
      }
    >
      <td>{symbol}</td>
      <td>
        <input
          type="number"
          value={shares}
          onChange={(e) => valtioSetShares(state, Number(e.target.value))}
        />
      </td>
      {/* ... */}
      <td>
        <button onClick={() => undo(state)}>Undo</button>
        <button onClick={() => redo(state)}>Redo</button>
      </td>
    </tr>
  );
}
```

Valtio's `useSnapshot()` gives per-entry isolation (each holding's snapshot is
independent). But `getDerived(state)` reads the proxy directly, not the
snapshot, so it does not participate in Valtio's render tracking. A price update
will re-derive when the component re-renders for other reasons, but will not
trigger a re-render on its own. Fixing this requires reading derived values from
the snapshot, which means moving the computation into the proxy (e.g., via
getters or `derive()`).

ValUse does not have this pitfall because all reactive reads go through
`.use()`, which always subscribes.

---

## The full picture

Complete source for both implementations. The ValUse model is 62 lines; the
Valtio model + helper functions are 205 lines. React components are similar: 77
vs 81 lines.

### ValUse — model ([`valuse.ts`](src/comparison/valuse.ts))

```ts
import { value, valueRef, valueScope } from 'valuse';
import { withHistory } from 'valuse/middleware';

export const refreshRateMs = value<number>(5_000);

export const holdingScope = withHistory(
  valueScope(
    {
      symbol: value<string>(),
      shares: value<number>(0),
      costBasis: value<number>(0),
      refreshRate: valueRef(refreshRateMs),
    },
    {
      price: async ({ scope, set, signal, deferBy }) => {
        while (!signal.aborted) {
          const res = await fetch(`/api/quote/${scope.symbol.use()}`, {
            signal,
          });
          set((await res.json()).price as number);
          await deferBy(scope.refreshRate.use());
        }
      },
    },
    {
      marketValue: ({ scope }) => {
        const price = scope.price.use();
        return price != null ? scope.shares.use() * price : undefined;
      },
      gainLoss: ({ scope }) => {
        const price = scope.price.use();
        if (price == null) return undefined;
        return (price - scope.costBasis.use()) * scope.shares.use();
      },
      gainLossPercent: ({ scope }) => {
        const price = scope.price.use();
        const basis = scope.costBasis.use();
        if (price == null || basis === 0) return undefined;
        return ((price - basis) / basis) * 100;
      },
    },
    {
      isUp: ({ scope }) => {
        const gainLoss = scope.gainLoss.use();
        return gainLoss != null ? gainLoss >= 0 : undefined;
      },
    },
  ),
  { maxDepth: 50, fields: ['shares', 'costBasis'] },
);
```

### Valtio — model ([`valtio.ts`](src/comparison/valtio.ts))

See [`valtio.ts`](src/comparison/valtio.ts) for the complete 206-line
implementation including `createHolding`, `getDerived`, mutations (`setShares`,
`setCostBasis`, `setSymbol`), undo/redo, polling, and the `createHoldingsMap`
collection wrapper.

### Components

See [`valuse.ui.tsx`](src/comparison/valuse.ui.tsx) and
[`valtio.ui.tsx`](src/comparison/valtio.ui.tsx). Both are compact. Valtio's
read/write split (`useSnapshot` for reads, proxy for writes) is clean once you
internalize it, but the `getDerived` gap (reading proxy vs. snapshot) is a real
DX gotcha.

For apps where state is simple (a few values, minimal derivations, no undo),
Valtio's simplicity is a genuine advantage over ValUse. The gap widens in the
other direction as structured concerns accumulate.
