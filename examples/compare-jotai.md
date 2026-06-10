# ValUse vs Jotai

Jotai gives you atoms: tiny reactive units that compose via dependency graphs.
Per-atom subscriptions provide genuinely fine-grained reactivity, and the
`atom(get => ...)` pattern is an elegant derivation primitive. Jotai is at its
best when state is naturally atomized: independent values with clear dependency
relationships. The friction appears when you need a cohesive entity with many
fields, coordinated mutations, and cross-cutting concerns like undo/redo.

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

**ValUse** defines the holding as layered declarations:

```ts
export const holdingScope = withHistory(
  valueScope(
    {
      symbol: value<string>(),
      shares: value<number>(0),
      costBasis: value<number>(0),
      refreshRate: valueRef(refreshRateMs),
    },
    { price: async ({ scope, set, signal, deferBy }) => { /* ... */ } },
    { marketValue: /* ... */, gainLoss: /* ... */, gainLossPercent: /* ... */ },
    { isUp: /* ... */ },
  ),
  { maxDepth: 50, fields: ['shares', 'costBasis'] },
);
```

One declaration site defines the entire entity: fields, derivations, async, and
undo behavior.

**Jotai** creates a factory function that returns a bag of atoms per holding:

```ts
export function createHoldingAtoms(init: {
  symbol: string;
  shares: number;
  costBasis: number;
}): HoldingAtoms {
  const symbolAtom = atom(init.symbol);
  const sharesAtom = atom(init.shares);
  const costBasisAtom = atom(init.costBasis);
  const priceAtom = atom<number | undefined>(undefined);

  const marketValueAtom = atom((get) => {
    const price = get(priceAtom);
    return price != null ? get(sharesAtom) * price : undefined;
  });

  const gainLossAtom = atom((get) => {
    /* ... */
  });
  const gainLossPercentAtom = atom((get) => {
    /* ... */
  });
  const isUpAtom = atom((get) => {
    /* ... */
  });

  return { symbol: symbolAtom, shares: sharesAtom /* ... */ };
}
```

This is clean and composable. Each atom's dependencies are explicit via `get()`.
The tradeoff is that "a holding" is not one thing but eight atoms returned from
a factory. Adding a field means creating a new atom and adding it to the
interface and the return object. And because each holding's atoms are
independent, you cannot enumerate all holdings from the atoms alone. The
collection must be tracked separately (the example threads the entry list as a
prop from the parent).

---

## Derived values

Both libraries handle sync derivations well, and the code is structurally
similar.

**ValUse:**

```ts
marketValue: ({ scope }) => {
  const price = scope.price.use();
  return price != null ? scope.shares.use() * price : undefined;
},
```

**Jotai:**

```ts
const marketValueAtom = atom((get) => {
  const price = get(priceAtom);
  return price != null ? get(sharesAtom) * price : undefined;
});
```

The pattern is nearly identical: declare dependencies, compute a value. Both
cache and both recompute only when dependencies change. Jotai's `get()` and
ValUse's `scope.field.use()` serve the same purpose. This is an area where both
libraries feel right at home.

---

## Async polling

**ValUse** treats the poll as an async derivation with automatic abort:

```ts
price: async ({ scope, set, signal, deferBy }) => {
  while (!signal.aborted) {
    const res = await fetch(`/api/quote/${scope.symbol.use()}`, { signal });
    set((await res.json()).price as number);
    await deferBy(scope.refreshRate.use());
  }
},
```

**Jotai** uses an imperative polling function with a manual AbortController. The
example avoids async atoms for the price itself, because an async atom would
infect all downstream derivations (marketValue, gainLoss, etc.) with `Promise`,
forcing `loadable()` or Suspense in every consumer:

```ts
export function startPolling(
  store: ReturnType<typeof createStore>,
  atoms: HoldingAtoms,
): AbortController {
  const controller = new AbortController();
  const { signal } = controller;

  (async () => {
    while (!signal.aborted) {
      const symbol = store.get(atoms.symbol);
      const res = await fetch(`/api/quote/${symbol}`, { signal });
      if (signal.aborted) break;
      store.set(atoms.price, (await res.json()).price as number);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, store.get(refreshRateMsAtom));
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    }
  })();

  return controller;
}
```

This is where the async contagion issue surfaces. Jotai's async atoms are
powerful and support `AbortSignal` natively, but any downstream
`atom(get => ...)` that reads an async atom must itself be async. In the
portfolio, that would mean `marketValueAtom`, `gainLossAtom`, `isUpAtom`, and
their consumers all become async. The alternative (used here) is to set the
price imperatively from outside, which works but sidesteps Jotai's reactive
model.

ValUse's async derivation sets a sync value that downstream derivations read
without async contagion. Whether that design choice is better or just different
depends on whether you prefer Suspense-first (Jotai's intended approach) or
inline-fallback (ValUse's approach) as the default for loading states.

---

## Undo / redo

**ValUse** wraps the scope with middleware:

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

// Per-instance undo/redo, works automatically:
holding.$undo();
holding.$redo();
```

**Jotai** requires a separate history object per holding and coordinated setter
functions:

```ts
export function createHoldingHistory(): HoldingHistory {
  return { past: [], future: [] };
}

export function setShares(
  store: ReturnType<typeof createStore>,
  atoms: HoldingAtoms,
  history: HoldingHistory,
  value: number,
): void {
  pushHistory(history, snapshot(store, atoms));
  store.set(atoms.shares, value);
}

export function undoHolding(
  store: ReturnType<typeof createStore>,
  atoms: HoldingAtoms,
  history: HoldingHistory,
): void {
  if (history.past.length === 0) return;
  history.future.unshift(snapshot(store, atoms));
  const prev = history.past.pop()!;
  store.set(atoms.shares, prev.shares);
  store.set(atoms.costBasis, prev.costBasis);
}
```

Every setter that should be undoable must route through a coordinated function
that takes the store, the atoms, and the history. The component needs all three
threaded through props or context. This is the cost of Jotai's atomic model:
cross-cutting concerns that span multiple atoms require manual coordination.

Jotai libraries like `jotai-history` exist to help, but the core library does
not provide this.

---

## Shared config

**ValUse** shares a reactive value across instances via `valueRef`:

```ts
export const refreshRateMs = value<number>(5_000);

const holdingScope = valueScope({
  refreshRate: valueRef(refreshRateMs),
  // ...
});
```

**Jotai** just reads a shared atom:

```ts
export const refreshRateMsAtom = atom(5_000);

// In the polling function:
const timer = setTimeout(resolve, store.get(refreshRateMsAtom));
```

This is one of Jotai's genuine strengths: any atom can read any other atom via
`get()`, and the dependency is tracked automatically. Both approaches work well
here; Jotai's is arguably simpler since any atom is already accessible from
anywhere.

---

## React components

**ValUse** hooks subscribe per field:

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

**Jotai** hooks subscribe per atom, which gives the same granularity:

```tsx
function HoldingRow({
  atoms,
  onUndo,
  onRedo,
}: {
  atoms: HoldingAtoms;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const symbol = useAtomValue(atoms.symbol);
  const [shares, setSharesRaw] = useAtom(atoms.shares);
  // ...
  return (
    <tr>
      {/* ... */}
      <td>
        <button onClick={onUndo}>Undo</button>
        <button onClick={onRedo}>Redo</button>
      </td>
    </tr>
  );
}
```

Both achieve fine-grained per-field subscriptions. The difference is in props:
ValUse passes a string `id` and looks up the instance; Jotai passes the atom bag
and undo/redo callbacks. The Jotai component needs more props because
coordinated operations (undo, redo) are not attached to the atoms themselves.

Note that `setSharesRaw` bypasses history because it sets the atom directly. The
component would need the store, atoms, and history threaded through to use the
coordinated `setShares()` function, which is why the example passes
`onUndo`/`onRedo` as callbacks from the parent.

---

## The full picture

Complete source for both implementations. The ValUse model is 62 lines; the
Jotai model + coordination functions are 200 lines.

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

### Jotai — model ([`jotai.ts`](src/comparison/jotai.ts))

See [`jotai.ts`](src/comparison/jotai.ts) for the complete 200-line
implementation including `createHoldingAtoms()`, `createHoldingHistory()`,
coordinated setters (`setShares`, `setCostBasis`, `setSymbol`),
`undoHolding`/`redoHolding`, and `startPolling`.

The line count difference is partly structural (Jotai declares each atom
separately) and partly because concerns that ValUse handles via middleware
(history) or framework features (async derivation, abort) must be implemented
manually. Jotai's approach trades compactness for composability: each piece is
an independent function you can test, replace, or omit.

### Components

See [`valuse.ui.tsx`](src/comparison/valuse.ui.tsx) and
[`jotai.ui.tsx`](src/comparison/jotai.ui.tsx) for the React components. Both are
under 100 lines. The main difference is prop threading: Jotai's `HoldingRow`
needs the atom bag and undo/redo callbacks passed in; ValUse's needs only a
string key.
