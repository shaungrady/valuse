# ValUse vs Zustand

Zustand gives you a single flat store with getters, setters, and selectors. The
API is small, the mental model is predictable, and the ecosystem (devtools,
persist, immer) is mature. Zustand stores are easy to reason about because
everything is explicit: you see every mutation, every selector, every state
transition. The cost of that explicitness shows up as structured data grows,
because per-entity logic (derivations, history, async) becomes boilerplate.

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

**ValUse** defines the holding as layered declarations, wrapped with history
middleware:

```ts
export const holdingScope = withHistory(
  valueScope(
    {
      symbol: value<string>(),
      shares: value<number>(0),
      costBasis: value<number>(0),
      refreshRate: valueRef(refreshRateMs),
    },
    // Layer 2: async price poll
    { price: async ({ scope, set, signal, deferBy }) => { /* ... */ } },
    // Layer 3: sync derivations from price
    { marketValue: ({ scope }) => { /* ... */ }, gainLoss: /* ... */ },
    // Layer 4: derived from derived
    { isUp: ({ scope }) => { /* ... */ } },
  ),
  { maxDepth: 50, fields: ['shares', 'costBasis'] },
);
```

Fields, derivations, async, and undo/redo middleware are all declared together.
The `withHistory` wrapper adds `$undo`, `$redo`, `$canUndo`, `$canRedo` to every
instance automatically.

**Zustand** separates the type, the store factory, and each operation:

```ts
export interface Holding {
  symbol: string;
  shares: number;
  costBasis: number;
  price: number | undefined;
}

export function createPortfolioStore() {
  return createStore<PortfolioState>((set, get) => ({
    refreshRateMs: 5_000,
    holdings: {},
    past: [],
    future: [],
    controllers: {},
    addHolding: (key, init) =>
      set((s) => ({
        /* spread */
      })),
    removeHolding: (key) =>
      set((s) => {
        /* spread, abort */
      }),
    setShares: (key, shares) =>
      set((s) => ({ ...pushHistory(s) /* spread */ })),
    setCostBasis: (key, costBasis) =>
      set((s) => ({
        /* ... */
      })),
    setSymbol: (key, symbol) =>
      set((s) => {
        /* restart polling */
      }),
    setPrice: (key, price) =>
      set((s) => ({
        /* spread */
      })),
    getDerived: (key) => {
      /* compute on call */
    },
    undo: () =>
      set((s) => {
        /* restore from past */
      }),
    redo: () =>
      set((s) => {
        /* restore from future */
      }),
    startPolling: (key) => {
      /* async IIFE with AbortController */
    },
    stopPolling: (key) => {
      /* abort controller */
    },
    destroy: () => {
      /* abort all */
    },
  }));
}
```

Every operation is a named method on the store. This is explicit and debuggable,
but the method count grows linearly with operations. The Zustand store ends up
at ~175 lines of action methods; the ValUse scope definition is ~55 lines.

The explicitness is genuine upside. You can read every mutation in one place,
and there is no hidden reactivity. Whether that trades favorably against the
compactness of the declarative approach depends on the team and the codebase.

---

## Derived values

**ValUse** derivations are reactive and cached. They declare their dependencies
via `scope.field.use()` and only recompute when those dependencies change:

```ts
marketValue: ({ scope }) => {
  const price = scope.price.use();
  return price != null ? scope.shares.use() * price : undefined;
},
```

**Zustand** computes derived values on demand via `getDerived()`:

```ts
getDerived: (key) => {
  const holding = get().holdings[key];
  if (!holding || holding.price == null) return { /* all undefined */ };
  const { price, shares, costBasis } = holding;
  const marketValue = shares * price;
  // ...
  return { marketValue, gainLoss, gainLossPercent, isUp };
},
```

This recomputes on every call. For a handful of holdings that is fine. For large
collections, ValUse's signal-based caching avoids redundant work. But Zustand's
approach is transparent: there is no cache invalidation to think about, and the
derived function is a plain function you can test in isolation.

---

## Async polling

**ValUse** treats the price poll as an async derivation. The `signal` is
provided automatically and abort fires when `scope.symbol.use()` changes:

```ts
price: async ({ scope, set, signal, deferBy }) => {
  while (!signal.aborted) {
    const res = await fetch(`/api/quote/${scope.symbol.use()}`, { signal });
    set((await res.json()).price as number);
    await deferBy(scope.refreshRate.use());
  }
},
```

**Zustand** manages the AbortController manually, stored outside the reactive
state (controllers are non-serializable):

```ts
startPolling: (key) => {
  const state = get();
  state.stopPolling(key);
  const controller = new AbortController();
  set((s) => ({ controllers: { ...s.controllers, [key]: controller } }));

  (async () => {
    const { signal } = controller;
    while (!signal.aborted) {
      const holding = get().holdings[key];
      if (!holding) break;
      const res = await fetch(`/api/quote/${holding.symbol}`, { signal });
      if (signal.aborted) break;
      get().setPrice(key, (await res.json()).price as number);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, get().refreshRateMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
  })();
},
```

ValUse handles abort and re-trigger automatically. Zustand requires explicit
lifecycle management, but gives you full control over when polling starts and
stops. If you need to pause polling without destroying the holding, Zustand
makes that straightforward; ValUse ties the poll lifecycle to the derivation's
dependency graph.

---

## Undo / redo

**ValUse** wraps the scope with `withHistory()`, which snapshots tracked fields
on every mutation and adds `$undo`/`$redo` methods per instance:

```ts
export const holdingScope = withHistory(
  valueScope({
    /* ... */
  }),
  { maxDepth: 50, fields: ['shares', 'costBasis'] },
);

// In components:
holding.$undo();
holding.$redo();
```

**Zustand** builds a manual history stack across all holdings:

```ts
past: [] as HistoryEntry[],
future: [] as HistoryEntry[],

setShares: (key, shares) =>
  set((state) => ({
    ...pushHistory(state),
    holdings: {
      ...state.holdings,
      [key]: { ...state.holdings[key]!, shares },
    },
  })),

undo: () =>
  set((state) => {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1]!;
    const restored: Record<string, Holding> = {};
    for (const [k, h] of Object.entries(previous.holdings)) {
      restored[k] = { ...h, price: state.holdings[k]?.price };
    }
    return {
      past: state.past.slice(0, -1),
      future: [{ holdings: snapshotForHistory(state.holdings) }, ...state.future],
      holdings: restored,
    };
  }),
```

Every setter that should be undoable must call `pushHistory()`. ValUse's
middleware handles this automatically for the declared `fields`. The Zustand
approach gives you a global undo (all holdings at once), while ValUse's is
per-instance. Which is better depends on the use case.

---

## Shared config

**ValUse** uses `valueRef` to share a reactive value across instances:

```ts
export const refreshRateMs = value<number>(5_000);

const holdingScope = valueScope({
  refreshRate: valueRef(refreshRateMs),
  // ...
});
```

Each holding reads `scope.refreshRate.use()` in its poll loop. When the shared
value changes, every holding's poll cycle picks up the new rate reactively.

**Zustand** puts the config in the store:

```ts
refreshRateMs: 5_000,
setRefreshRate: (ms) => set({ refreshRateMs: ms }),
```

Polling loops read it via `get().refreshRateMs`. This works, but the read is a
point-in-time snapshot inside the async loop rather than a reactive
subscription. The next poll iteration picks up the change, which is good enough
for most cases.

---

## React components

**ValUse** hooks subscribe per field, so only the changed field triggers a
re-render:

```tsx
function HoldingRow({ id }: { id: string }) {
  const holding = holdings.get(id)!;
  const [symbol] = holding.symbol.use();
  const [shares, setShares] = holding.shares.use();
  const [costBasis] = holding.costBasis.use();
  const [marketValue] = holding.marketValue.use();
  const [gainLossPercent] = holding.gainLossPercent.use();
  const [isUp] = holding.isUp.use();

  return (
    <tr
      className={
        isUp ? 'gain'
        : isUp === false ?
          'loss'
        : ''
      }
    >
      <td>{symbol}</td>
      <td>
        <input
          type="number"
          value={shares}
          onChange={(e) => setShares(Number(e.target.value))}
        />
      </td>
      {/* ... */}
      <td>
        <button onClick={holding.$undo}>Undo</button>
        <button onClick={holding.$redo}>Redo</button>
      </td>
    </tr>
  );
}
```

**Zustand** uses selectors for per-holding isolation:

```tsx
function HoldingRow({ id }: { id: string }) {
  const holding = useStore(store, selectHolding(id));
  const setShares = useStore(store, (s) => s.setShares);
  const derived = useStore(store, (s) => s.getDerived(id));
  const undo = useStore(store, (s) => s.undo);
  const redo = useStore(store, (s) => s.redo);

  if (!holding) return null;

  return (
    <tr
      className={
        derived.isUp ? 'gain'
        : derived.isUp === false ?
          'loss'
        : ''
      }
    >
      <td>{holding.symbol}</td>
      <td>
        <input
          type="number"
          value={holding.shares}
          onChange={(e) => setShares(id, Number(e.target.value))}
        />
      </td>
      {/* ... */}
      <td>
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
      </td>
    </tr>
  );
}
```

Both achieve per-row isolation. ValUse does it via field-level signals; Zustand
does it via selectors. The ValUse approach is more granular (a price change does
not re-render the shares input), but the Zustand approach is more familiar to
teams already using selector patterns.

Note that `getDerived(id)` returns a new object on every call, so the `derived`
selector triggers a re-render whenever any holding in the store changes.
Zustand's `useShallow` or a custom equality function can fix this, but it
requires awareness of the issue.

---

## The full picture

Complete source for both implementations. The ValUse model is 62 lines; the
Zustand store is 270 lines. The React components are comparable in length (77 vs
80 lines).

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

### Zustand — store ([`zustand.ts`](src/comparison/zustand.ts))

See [`zustand.ts`](src/comparison/zustand.ts) for the complete 270-line
implementation including the `PortfolioState` type, `pushHistory` /
`snapshotForHistory` helpers, `createPortfolioStore` factory (holdings CRUD,
derived computation, undo/redo, polling lifecycle), and `selectHolding`
selector.

### Components

See [`valuse.ui.tsx`](src/comparison/valuse.ui.tsx) and
[`zustand.ui.tsx`](src/comparison/zustand.ui.tsx). Both are compact (77 vs 80
lines). Zustand components use selectors for per-holding isolation; ValUse uses
field-level signals.

The React layer is similar in size. The difference is upstream: ValUse's 62
lines of model definition replaces Zustand's 270 lines of store + helpers,
largely because derivations, history, and async lifecycle are handled by the
framework rather than implemented per store.

Zustand's store is longer, but it is also completely transparent. There is no
hidden reactivity, no implicit dependency tracking, no middleware magic. For
teams that value explicit control and debuggability over brevity, that is a real
advantage.
