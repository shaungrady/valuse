# ValUse vs MobX

MobX is the closest philosophical match to ValUse. It pioneered fine-grained
reactivity in React, and its cached `computed` getters remain the gold standard
for derived state. Property access is clean, dependency tracking is automatic,
and the library is battle-tested across thousands of production apps. The
differences are mostly in API shape: MobX uses classes and decorators, ValUse
uses plain object declarations; MobX wraps components with `observer()`, ValUse
uses per-field `.use()` hooks; MobX's async story is generator-based `flow()` or
manual, ValUse treats async as a derivation.

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

**MobX** uses a class with `makeAutoObservable`:

```ts
export class HoldingModel {
  symbol: string;
  shares: number;
  costBasis: number;
  price: number | undefined = undefined;

  private past: HistorySnapshot[] = [];
  private future: HistorySnapshot[] = [];
  private controller: AbortController | undefined = undefined;

  constructor(init: { symbol: string; shares: number; costBasis: number }) {
    this.symbol = init.symbol;
    this.shares = init.shares;
    this.costBasis = init.costBasis;
    makeAutoObservable(this, {
      startPolling: false,
      stopPolling: false,
      destroy: false,
    });
  }

  get marketValue() {
    /* ... */
  }
  get gainLoss() {
    /* ... */
  }

  setShares(shares: number) {
    this.pushHistory();
    this.shares = shares;
  }
  // ...
}
```

MobX's class model is familiar and self-contained: fields, computed getters, and
actions live together on the class. The `makeAutoObservable` call tells MobX to
infer observable/computed/action annotations automatically (with explicit
overrides for non-reactive methods like `startPolling`).

ValUse's declaration is more compact, but MobX's class has a genuine advantage:
the model is standard TypeScript. You can use inheritance, implement interfaces,
add private methods, and use all of TypeScript's class features. ValUse's scope
declarations are more constrained. (One caveat: `makeAutoObservable` cannot be
used on classes that have a superclass or are themselves subclassed. You must
fall back to `makeObservable` with explicit annotations when inheritance is
involved.)

---

## Derived values

Both libraries cache derived values and recompute only when dependencies change.
This is where MobX and ValUse are most alike.

**ValUse:**

```ts
marketValue: ({ scope }) => {
  const price = scope.price.use();
  return price != null ? scope.shares.use() * price : undefined;
},
```

**MobX:**

```ts
get marketValue(): number | undefined {
  return this.price != null ? this.shares * this.price : undefined;
}
```

MobX's version is cleaner: a plain getter with `this` access, no wrapping
function, no `.use()` call. MobX tracks property reads through its proxy, so
`this.price` and `this.shares` are automatically registered as dependencies.
This is arguably the better DX for computed values specifically.

ValUse requires the explicit `.use()` to register dependencies, which is more
verbose but also more predictable: you always know exactly which reads are
tracked.

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

Abort and re-trigger are handled by the framework. Changing the symbol
automatically aborts the current poll and starts a new one.

**MobX** uses a manual async loop with `runInAction` for state updates:

```ts
startPolling() {
  this.stopPolling();
  const controller = new AbortController();
  this.controller = controller;
  const { signal } = controller;

  (async () => {
    while (!signal.aborted) {
      try {
        const res = await fetch(`/api/quote/${this.symbol}`, { signal });
        if (signal.aborted) break;
        const data = await res.json();
        runInAction(() => {
          this.price = data.price as number;
        });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, refreshConfig.rateMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      } catch { break; }
    }
  })();
}
```

MobX's `flow()` with generators is the idiomatic alternative to `runInAction`,
but either way the AbortController management, re-trigger on symbol change, and
polling lifecycle are manual. MobX offers `reaction()` to watch the symbol and
restart polling, but wiring that up is additional code.

This is the widest gap between the two libraries. Both handle sync reactivity
well; async is where ValUse's derivation model provides the most leverage.

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

**MobX** implements a manual snapshot stack on the class:

```ts
private snapshot(): HistorySnapshot {
  return { shares: this.shares, costBasis: this.costBasis };
}

private pushHistory() {
  this.past.push(this.snapshot());
  if (this.past.length > 50) this.past.shift();
  this.future.length = 0;
}

setShares(shares: number) {
  this.pushHistory();
  this.shares = shares;
}

undo() {
  if (this.past.length === 0) return;
  this.future.unshift(this.snapshot());
  const prev = this.past.pop()!;
  this.shares = prev.shares;
  this.costBasis = prev.costBasis;
}
```

The implementation is straightforward. Every mutating method must call
`pushHistory()`. MobX libraries like `mobx-state-tree` have built-in
snapshotting that makes undo simpler, but the core library leaves it to you.

ValUse's middleware eliminates the manual `pushHistory()` call in each setter.
MobX's manual approach gives you full control over what gets snapshotted and
when, at the cost of remembering to call `pushHistory()` in every setter.

---

## Shared config

**ValUse** shares via `valueRef`:

```ts
export const refreshRateMs = value<number>(5_000);
// In scope definition:
refreshRate: valueRef(refreshRateMs),
```

**MobX** uses a shared observable class:

```ts
export class RefreshConfig {
  rateMs = 5_000;
  constructor() {
    makeAutoObservable(this);
  }
  setRate(ms: number) {
    this.rateMs = ms;
  }
}

export const refreshConfig = new RefreshConfig();
```

Both work well. MobX's approach is standard OOP: a shared instance referenced by
whoever needs it. ValUse's is a shared reactive value threaded into scopes.
MobX's automatic proxy tracking means any computed or reaction reading
`refreshConfig.rateMs` will update when it changes.

---

## React components

**ValUse** uses per-field `.use()` hooks:

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

**MobX** wraps the component with `observer()` and reads properties directly:

```tsx
const HoldingRow = observer(function HoldingRow({
  holding,
}: {
  holding: HoldingModel;
}) {
  const { symbol, shares, costBasis, marketValue, gainLossPercent, isUp } =
    holding;

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
          onChange={(e) => holding.setShares(Number(e.target.value))}
        />
      </td>
      {/* ... */}
      <td>
        <button onClick={() => holding.undo()}>Undo</button>
        <button onClick={() => holding.redo()}>Redo</button>
      </td>
    </tr>
  );
});
```

MobX's component code is arguably cleaner: destructure the model, use the
values, done. No `.use()` calls, no `[value, setter]` tuples. The `observer()`
HOC tracks which properties the render function reads and subscribes to exactly
those.

The tradeoff is that `observer()` must wrap every component that reads
observables. Forget it and the component silently stops reacting. There is no
runtime warning. ValUse's `.use()` calls are more verbose but fail loudly if
misused (calling a hook outside React throws).

Both achieve the same granularity: changing one holding's price re-renders only
that row.

---

## The full picture

Complete source for both implementations. The ValUse model is 62 lines; the MobX
model (class + collection) is 218 lines. React components are similar: 77 vs 74
lines.

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

### MobX — model ([`mobx.ts`](src/comparison/mobx.ts))

See [`mobx.ts`](src/comparison/mobx.ts) for the complete 218-line implementation
including `HoldingModel` (fields, computeds, history, polling) and
`HoldingsCollection` (observable map wrapper).

### Components

See [`valuse.ui.tsx`](src/comparison/valuse.ui.tsx) and
[`mobx.ui.tsx`](src/comparison/mobx.ui.tsx). Both are compact (77 and 74 lines).
MobX's component code is slightly cleaner thanks to direct property access and
destructuring, but every component must be wrapped with `observer()`.

Of the libraries compared here, MobX is the one where the DX is closest to
ValUse. The core difference is declaration style (classes vs. scope
declarations) and how much the framework handles for you (async derivation,
middleware). Teams already invested in MobX have less reason to switch than
teams using other libraries, because the reactive model is fundamentally
similar.
