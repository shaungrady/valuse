# Comparisons

Each comparison below implements the same feature using ValUse and one other
library: a stock portfolio tracker with holdings, async price polling, derived
gain/loss metrics, per-field undo/redo, and shared configuration. The portfolio
covers enough surface area to show real differences without being contrived.

What each implementation must handle:

- **Model definition**: holding fields (symbol, shares, costBasis) as a keyed
  collection, with layered derivations (marketValue, gainLoss, gainLossPercent,
  isUp)
- **Derived values**: cached computations that read async results synchronously
- **Async with abort**: periodic price polling that cancels when the symbol
  changes
- **Undo / redo**: tracked history for shares and costBasis edits
- **Shared config**: a refresh rate readable by every holding instance
- **React components**: per-holding render isolation

Source code for all six implementations lives in
[`examples/src/comparison/`](src/comparison/).

---

### Zustand

[Compare](compare-zustand.md) |
[zustand-demo.pmnd.rs](https://zustand-demo.pmnd.rs/)

A single flat store with getters, setters, and selectors. Zustand is popular for
good reason: the API is small, the mental model is predictable, and the
ecosystem (devtools, persist, immer) is mature. The tradeoff shows up as
structured data grows. Every mutation spreads the holdings map, derived values
are recomputed on each call (no caching), undo/redo needs a hand-rolled history
stack, and per-holding render isolation requires writing selectors.

### Jotai

[Compare](compare-jotai.md) | [jotai.org](https://jotai.org/)

Atoms that compose via dependency graphs. Jotai's per-atom subscriptions give
genuinely fine-grained reactivity, and `atom(get => ...)` is an elegant
derivation primitive. The cost is structural: there is no single "holding"
definition, so the model is scattered across atom declarations. Coordinated
mutations (undo/redo across multiple atoms) require threading the store and
history through props or context. Async atoms infect downstream derivations with
`Promise`, requiring `loadable()` or Suspense boundaries.

### MobX

[Compare](compare-mobx.md) | [mobx.js.org](https://mobx.js.org/README.html)

The closest philosophical match. MobX pioneered fine-grained reactivity in
React, and its cached `computed` getters are the gold standard for derived
state. Property access is clean and dependency tracking is automatic. The
ceremony is in the setup: class-based models with `makeAutoObservable`,
`observer()` on every React component, and `runInAction` for async mutations.
Undo/redo and abort are still manual.

### Valtio

[Compare](compare-valtio.md) | [valtio.dev](https://valtio.dev/)

Proxy-based state with the simplest mutation API of any library: just assign to
properties. For straightforward state, nothing is easier to learn or write. The
tradeoff is that Valtio provides no built-in structure beyond the proxy itself:
no derivation caching, no lifecycle hooks, no async primitives. Adding those
concerns means writing the same imperative code you would without a library.

### React Context

[Compare](compare-react-context.md) |
[react.dev](https://react.dev/learn/passing-data-deeply-with-context)

The zero-dependency baseline: `useReducer` + `createContext`. Context works well
for infrequently changing values like theme, locale, or auth. Using it for
structured, frequently updating data exposes fundamental limitations: every
context consumer re-renders on any state change, action types grow linearly with
operations, and async requires manual `useEffect` + `AbortController`.
