# Comparisons

> State libraries make you choose: one big store (Zustand) or scattered atoms
> (Jotai). ValUse gives you **scopes** — structured, reactive models with typed
> fields, derived state, and lifecycle hooks built in, so your state mirrors how
> your data actually works instead of how your framework wants it.

Each comparison below builds the same feature — a user table with editable rows,
derived display names, change tracking, async profile fetch with abort, per-row
React subscriptions, reusable middleware, lifecycle hooks, and shared/nested
state — so you can see exactly where ValUse diverges from each library.

---

### Zustand

[Compare Zustand to ValUse](compare-zustand.md) |
[Zustand-demo.pmnd.rs](https://zustand-demo.pmnd.rs/)

Zustand gives you a single store with getters, setters, and selectors. It's
simple to start with, but structured data — collections of entities with
per-item derived state, change tracking, and async — requires increasingly
manual wiring. Every mutation spreads the entire state object, and per-row
render isolation means writing selectors by hand.

### Jotai

[Compare Jotai to ValUse](compare-jotai.md) | [Jotai.org](https://jotai.org/)

Jotai gives you atoms — tiny reactive units that compose via dependency graphs.
Per-atom subscriptions provide fine-grained reactivity, but there's no single
definition that says "an entity has these fields." A model with typed fields,
derivations, and lifecycle is scattered across many `atomFamily` declarations,
and async is contagious — downstream atoms inherit the async nature of their
dependencies.

### MobX

[Compare MobX to ValUse](compare-mobx.md) |
[MobX.js.org](https://mobx.js.org/README.html)

MobX is the closest philosophical match — observable objects with computed
values and reactions. It pioneered fine-grained reactivity in React and its
property access is clean. The tradeoff is class-based models with
`makeAutoObservable`, `observer()` wrappers on every component, and
generator-based `flow()` for async with manual abort.

### Valtio

[Compare Valtio to ValUse](compare-valtio.md) |
[Valtio.dev](https://valtio.dev/)

Valtio gives you proxy-based state — mutate a plain object and the UI reacts.
It's the simplest API of any state library and nested proxies give decent
per-row isolation. But there's no structured model, no per-entity derivations,
and no reactive async — adding those concerns requires the same manual wiring as
any non-reactive approach.

### React Context

[Compare React Context to ValUse](compare-react-context.md) |
[React.dev](https://react.dev/learn/passing-data-deeply-with-context)

The "no library" baseline — `useReducer` + `createContext`, no external
dependencies. It works for infrequently changing values like theme or auth, but
using it for structured, frequently updating data exposes fundamental
limitations: every context consumer re-renders on any state change, action types
grow linearly with operations, and async requires manual `AbortController` +
`useEffect`.
