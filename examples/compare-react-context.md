# ValUse vs React Context

React Context is the zero-dependency baseline: `useReducer` + `createContext`,
no external libraries. It works everywhere React runs. For infrequently changing
values (theme, locale, auth), Context is the right tool and no state library can
match the simplicity of "zero dependencies." The limitations surface when you
use it for structured, frequently updating state: every context consumer
re-renders on any change, action types grow linearly, and async requires manual
`useEffect` + `AbortController`.

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

**Context** defines a type, an action union, and a reducer:

```ts
export interface Holding {
  symbol: string;
  shares: number;
  costBasis: number;
  price: number | undefined;
}

export type PortfolioAction =
  | { type: 'ADD_HOLDING'; key: string; init: Omit<Holding, 'price'> }
  | { type: 'REMOVE_HOLDING'; key: string }
  | { type: 'SET_SHARES'; key: string; shares: number }
  | { type: 'SET_COST_BASIS'; key: string; costBasis: number }
  | { type: 'SET_SYMBOL'; key: string; symbol: string }
  | { type: 'SET_PRICE'; key: string; price: number }
  | { type: 'SET_REFRESH_RATE'; rateMs: number }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function portfolioReducer(
  state: PortfolioState,
  action: PortfolioAction,
): PortfolioState {
  switch (action.type) {
    case 'SET_SHARES':
      return withHistory(
        state,
        updateHolding(state.holdings, action.key, { shares: action.shares }),
      );
    // ... 8 more cases
  }
}
```

The action union and switch statement are the classic React pattern. It is
explicit, predictable, and easy to debug with React DevTools. The cost is
boilerplate: every new operation requires a new action type, a new case in the
switch, and (typically) a new spread of the state tree. The portfolio's reducer
has 9 action types and ~90 lines of switch cases.

Context's action-based model has a real advantage for teams that value explicit
state transitions. Every mutation is a named, typed event that can be logged,
replayed, or serialized. ValUse's direct `.set()` calls are more concise but
less auditable.

---

## Derived values

**ValUse** derivations are reactive and cached:

```ts
marketValue: ({ scope }) => {
  const price = scope.price.use();
  return price != null ? scope.shares.use() * price : undefined;
},
```

**Context** computes on demand via a plain function:

```ts
export function getDerived(holding: Holding): HoldingDerived {
  const { price, shares, costBasis } = holding;
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

A plain function with no dependencies to manage. It recomputes on every call,
which is fine for small collections. For inline use in components, you would
wrap it with `useMemo`, but since the reducer produces a new holding object on
every state change, the `[holding]` dependency changes each time. In practice,
`useMemo` recomputes on every context update, which with Context is frequent.

---

## Async polling

**ValUse** treats the poll as a reactive async derivation:

```ts
price: async ({ scope, set, signal, deferBy }) => {
  while (!signal.aborted) {
    const res = await fetch(`/api/quote/${scope.symbol.use()}`, { signal });
    set((await res.json()).price as number);
    await deferBy(scope.refreshRate.use());
  }
},
```

**Context** uses a standalone async function with a manual AbortController:

```ts
export function startPolling(
  getState: () => PortfolioState,
  dispatch: (action: PortfolioAction) => void,
  key: string,
): AbortController {
  const controller = new AbortController();
  const { signal } = controller;

  (async () => {
    while (!signal.aborted) {
      try {
        const symbol = getState().holdings[key]?.symbol;
        if (!symbol) break;
        const res = await fetch(`/api/quote/${symbol}`, { signal });
        if (signal.aborted) break;
        dispatch({
          type: 'SET_PRICE',
          key,
          price: (await res.json()).price as number,
        });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, getState().refreshRateMs);
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

  return controller;
}
```

The polling function needs both `getState` (to read the current symbol and
refresh rate) and `dispatch` (to update the price). In a real app, starting and
stopping the poll would live in a `useEffect`, and the component would need to
manage the `AbortController` reference across renders.

This is the widest gap: ValUse makes async reactive (the poll restarts when the
symbol changes), while Context treats async as a side effect the developer must
orchestrate.

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

**Context** builds a manual history stack in the reducer:

```ts
function withHistory(
  state: PortfolioState,
  newHoldings: Record<string, Holding>,
): PortfolioState {
  return {
    ...state,
    past: [...state.past,
      { holdings: snapshotHoldings(state.holdings) }].slice(-50),
    future: [],
    holdings: newHoldings,
  };
}

// In the reducer:
case 'SET_SHARES':
  return withHistory(state,
    updateHolding(state.holdings, action.key, { shares: action.shares }));

case 'UNDO': {
  if (state.past.length === 0) return state;
  const prev = state.past[state.past.length - 1]!;
  const restored: Record<string, Holding> = {};
  for (const [k, h] of Object.entries(prev.holdings)) {
    restored[k] = { ...h, price: state.holdings[k]?.price };
  }
  return {
    ...state,
    past: state.past.slice(0, -1),
    future: [{ holdings: snapshotHoldings(state.holdings) }, ...state.future],
    holdings: restored,
  };
}
```

Every case that should be undoable must call `withHistory()`. The undo/redo
cases themselves are verbose because they must snapshot, restore, and preserve
prices (which should not be undone).

This is actually a good illustration of where reducers shine, though. The entire
state transition is a pure function: given state and action, return new state.
You can unit-test the reducer in isolation, serialize the action log, and replay
it deterministically. ValUse's middleware is more concise but less transparent.

---

## Shared config

**ValUse:**

```ts
export const refreshRateMs = value<number>(5_000);
refreshRate: valueRef(refreshRateMs),
```

**Context** puts it in the state and dispatches to change it:

```ts
// In state:
refreshRateMs: 5_000,

// In the action union:
| { type: 'SET_REFRESH_RATE'; rateMs: number }

// In the reducer:
case 'SET_REFRESH_RATE':
  return { ...state, refreshRateMs: action.rateMs };
```

Three places for one config value: state, action type, reducer case. This is the
general pattern with Context: the cost of each new piece of state is not the
state itself but the action + reducer plumbing around it.

---

## React components

**ValUse** uses per-field hooks:

```tsx
function HoldingRow({ id }: { id: string }) {
  const holding = holdings.get(id)!;
  const [symbol] = holding.symbol.use();
  const [shares, setShares] = holding.shares.use();
  // ...
}
```

**Context** reads the entire state via `useContext`:

```tsx
function HoldingRow({ id }: { id: string }) {
  // Re-renders on ANY state change
  const { state, dispatch } = useContext(PortfolioCtx);
  const holding = state.holdings[id];
  if (!holding) return null;
  const derived = getDerived(holding);

  return (
    <tr>
      <td>{holding.symbol}</td>
      <td>
        <input
          type="number"
          value={holding.shares}
          onChange={(e) =>
            dispatch({
              type: 'SET_SHARES',
              key: id,
              shares: Number(e.target.value),
            })
          }
        />
      </td>
      {/* ... */}
      <td>
        <button onClick={() => dispatch({ type: 'UNDO' })}>Undo</button>
        <button onClick={() => dispatch({ type: 'REDO' })}>Redo</button>
      </td>
    </tr>
  );
}
```

This is Context's fundamental limitation for fine-grained state:
`useContext(PortfolioCtx)` subscribes to the entire state object. Editing one
holding's shares re-renders every `HoldingRow` in the list. `React.memo` can
help at the component boundary, but the context read itself always triggers.

The only true fix is splitting into per-entity contexts (one provider per
holding), which is impractical for dynamic collections. Libraries like
`use-context-selector` add selector support but are external dependencies, which
defeats the "zero dependencies" premise.

ValUse's per-field subscriptions avoid this entirely. But for apps where the
data changes infrequently (forms, settings, dashboards with occasional updates),
Context's re-render behavior is a non-issue and the simplicity of zero
dependencies is a genuine win.

---

## The full picture

Complete source for both implementations. The ValUse model is 62 lines; the
Context reducer + helpers are 247 lines. React components: 77 vs 98 lines.

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

### Context — reducer ([`react-context.ts`](src/comparison/react-context.ts))

See [`react-context.ts`](src/comparison/react-context.ts) for the complete
247-line implementation including the `Holding` type, `PortfolioAction` union (9
cases), `portfolioReducer`, `getDerived`, and `startPolling`.

### Components

See [`valuse.ui.tsx`](src/comparison/valuse.ui.tsx) and
[`react-context.ui.tsx`](src/comparison/react-context.ui.tsx). Context's
component is 20 lines longer, primarily due to the `PortfolioCtx` setup (context
creation, `useReducer`, two providers) and the verbose `dispatch({ type: ... })`
calls.

Context's action/reducer model is the most explicit of any approach compared
here. Every state transition is a named, typed event. For debugging and testing,
that transparency has real value. The cost is verbosity and the re-render
problem. Whether that trade is acceptable depends on how often your state
changes and how many consumers are listening.
