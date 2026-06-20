# Actions

`withActions` adds typed, imperative **actions** to a scope — named methods that
read and write the instance, the way a Pinia store has actions next to its state
and getters. An action bundles a multi-step (often async) mutation behind a name
and lands as a plain callable on every instance, alongside fields, derivations,
and `$`-methods.

```ts
import { valueScope, value } from 'valuse';
import { withActions } from 'valuse/middleware';

const counterScope = withActions(
  valueScope({ count: value(0) }),
  {
    increment:
      ({ scope }) =>
      (by: number) =>
        scope.count.set(scope.count.get() + by),
  },
  {
    reset:
      ({ scope }) =>
      () =>
        scope.increment(-scope.count.get()), // calls increment, typed
  },
);

const counter = counterScope.create({ count: 5 });
counter.increment(3); // count: 8
counter.reset(); // count: 0
```

`counter.increment` is typed `(by: number) => void`; `counter.reset` is
`() => void`. They sit next to `counter.count` (a field) and `counter.$undo` (if
history is layered on) on the same instance.

## Table of contents

- [The action shape](#the-action-shape)
- [Layers and calling other actions](#layers-and-calling-other-actions)
- [Async actions and `signal`](#async-actions-and-signal)
- [Per-invocation cleanup](#per-invocation-cleanup)
- [The factory runs per invocation](#the-factory-runs-per-invocation)
- [Name collisions](#name-collisions)
- [Composing with other middleware](#composing-with-other-middleware)
- [Actions in a `ScopeMap`](#actions-in-a-scopemap)
- [React and snapshots](#react-and-snapshots)
- [Action, derivation, or hook?](#action-derivation-or-hook)
- [Authoring middleware: `AugmentedScopeTemplate`](#authoring-middleware-augmentedscopetemplate)

---

## The action shape

Every action is a curried factory:

```ts
({ scope, signal, onCleanup }) =>
  (...args) =>
    result;
```

- The outer function is the **factory**. It receives the action context and
  returns the action.
- The inner function is the **action** — the public callable on the instance.
  Its signature (`(...args) => result`) is exactly what callers see.

The context:

| Field       | What it is                                                                |
| ----------- | ------------------------------------------------------------------------- |
| `scope`     | The live instance: fields, derivations, `$`-methods, and sibling actions. |
| `signal`    | An `AbortSignal` that aborts when the instance is destroyed.              |
| `onCleanup` | Register teardown scoped to the current invocation.                       |

There is no `this`. Everything is reached through `scope`:

```ts
withActions(emailScope, {
  send:
    ({ scope }) =>
    () => {
      scope.status.set('sending'); // write a field
      const body = scope.preview.get(); // read a derivation
      scope.$getSnapshot(); // call a $-method
    },
});
```

## Layers and calling other actions

Actions are declared in ordered **layers** — each record argument after the
template is one layer. The rule mirrors derivation layers: an action can call
actions from **earlier** layers, but **not** ones in its own layer.

```ts
withActions(
  cartScope,
  {
    // layer 1
    addItem:
      ({ scope }) =>
      (sku: string) => {
        /* ... */
      },
  },
  {
    // layer 2 — sees layer 1
    addBundle:
      ({ scope }) =>
      (skus: string[]) => {
        for (const sku of skus) scope.addItem(sku); // typed
      },
  },
);
```

Calling a sibling in the **same** layer is a type error — split it into a later
layer:

```ts
withActions(scope, {
  a:
    ({ scope }) =>
    () =>
      scope.b(), // ✗ `b` is in the same layer
  b: () => () => {},
});
```

This works because each layer is typed against the accumulated members of the
ones before it — the same mechanism that lets `withActions(withHistory(...))`
see `$undo`. The variadic form supports up to **11 layers**; beyond that, nest
calls (`withActions(withActions(t, l1), l2)`), which has no limit.

## Async actions and `signal`

An action can be `async`. Its returned promise is handed straight back to the
caller, so you can `await` it. Use `signal` to bail out of work that outlived
the instance:

```ts
withActions(searchScope, {
  run:
    ({ scope, signal }) =>
    async (query: string) => {
      scope.status.set('loading');
      const res = await fetch(`/api/search?q=${query}`, { signal });
      if (signal.aborted) return; // instance was destroyed mid-flight
      scope.results.set(await res.json());
      scope.status.set('idle');
    },
});

const search = searchScope.create();
await search.run('valuse');
```

`signal` aborts during `$destroy()`, before the rest of teardown runs, so a
post-`await` `signal.aborted` check reliably catches a destroyed instance.
Writes to a destroyed instance are no-ops, so a stray `.set()` after destroy
won't throw — but `signal` lets you skip the wasted work.

## Per-invocation cleanup

`onCleanup` registers teardown bound to **that one call**. It runs when the call
settles (sync return, or the promise resolves/rejects) or when the instance is
destroyed mid-flight — whichever comes first, exactly once. It is safe to call
after an `await`.

```ts
withActions(streamScope, {
  connect:
    ({ scope, onCleanup }) =>
    async (url: string) => {
      const socket = new WebSocket(url);
      onCleanup(() => socket.close()); // closed on settle or on destroy

      await new Promise((r) => socket.addEventListener('open', r));
      scope.connected.set(true);
    },
});
```

Cleanups are **per invocation**, so calling an action a thousand times does not
accumulate a thousand teardowns on the instance — each call cleans up after
itself. For simple "run this when the call finishes" teardown, a plain
`try/finally` works just as well; reach for `onCleanup` when the teardown should
also fire if the instance is destroyed before the call completes.

A cleanup registered _after_ the instance is already destroyed is skipped — the
instance is gone, so its teardown is moot.

## The factory runs per invocation

The factory (the outer function) runs **once per call**, not once per instance.
This is what lets `onCleanup` scope to a single invocation. Treat the factory
body as the action's prologue, not as setup:

```ts
withActions(scope, {
  // ✗ `calls` resets every invocation — the factory re-runs each call.
  track: ({ scope }) => {
    let calls = 0;
    return () => {
      calls += 1;
    };
  },
});
```

Per-instance state belongs in a scope field (or `valuePlain`), not an action
closure. The per-call cost is one inner-function allocation — negligible for
event-driven use.

## Name collisions

Action names share the instance's namespace with fields, derivations,
`$`-methods, and members added by other middleware. To keep that namespace safe,
`create()` **throws** when an action name:

- starts with `$` — that prefix is reserved for framework and middleware methods
  (`$getSnapshot`, history's `$undo`, …); or
- already exists on the instance (a field, derivation, `$`-method, prior
  augmentation, or another action — including a duplicate across layers).

```ts
withActions(valueScope({ count: value(0) }), {
  count: () => () => {}, // ✗ throws on create(): collides with the `count` field
});
```

Because the check runs in the actions middleware's own `onCreate`, apply
`withActions` as the **outermost** wrapper if another middleware might attach a
member with the same (non-`$`) name.

## Composing with other middleware

`withActions` returns an
[`AugmentedScopeTemplate`](#authoring-middleware-augmentedscopetemplate), which
is still a `ScopeTemplate`, so it composes in either direction with the other
middleware — and the instance surfaces **stack** rather than overwrite:

```ts
import { withActions, withHistory, withPersistence } from 'valuse/middleware';

const todoScope = withPersistence(
  withActions(withHistory(valueScope({ items: value<string[]>([]) })), {
    add:
      ({ scope }) =>
      (text: string) =>
        scope.items.set([...scope.items.get(), text]),
  }),
  { key: 'todos', adapter: localStorageAdapter },
);

const todos = todoScope.create();
todos.add('write docs'); // action
todos.$undo(); // history — both typed on the same instance
// …and persisted to localStorage
```

Actions inside an action see prior augmentations too — an action declared after
`withHistory` can call `scope.$undo()`, typed.

## Actions in a `ScopeMap`

`createMap` carries actions onto every entry:

```ts
const rowScope = withActions(valueScope({ done: value(false) }), {
  toggle:
    ({ scope }) =>
    () =>
      scope.done.set(!scope.done.get()),
});

const rows = rowScope.createMap();
rows.set('a', { done: false });
rows.get('a')!.toggle(); // done: true
```

Each entry is its own instance with its own `signal` and per-invocation cleanup;
deleting an entry destroys it and runs any in-flight cleanups.

## React and snapshots

- **Stable identity.** Each action is attached once per instance, so
  `instance.add` is referentially stable across renders — safe to pass as a prop
  or list in a hook dependency array.
- **Not in snapshots.** Actions are instance methods, not fields, so they never
  appear in `$getSnapshot()` / `$use()`. `withPersistence`, `withHistory`, and
  `withDevtools` serialize fields only — they never try to store a function.

## Action, derivation, or hook?

| You want to…                                   | Use                               |
| ---------------------------------------------- | --------------------------------- |
| Compute a value from state, reactively         | a **derivation**                  |
| Imperatively mutate state on demand (a method) | an **action**                     |
| React to a change automatically                | `onChange` / a derivation effect  |
| Run setup/teardown tied to instance lifetime   | `onCreate` (`onCleanup`/`signal`) |

Actions never introduce a new reactive capability — they organize imperative
mutations you could also write by hand. That's why they live in middleware, not
the core: the core stays a small set of primitives, and actions compose on top.

## Authoring middleware: `AugmentedScopeTemplate`

`withActions` is built on a reusable core type,
`AugmentedScopeTemplate<Def, Ext>` (exported from `valuse`) — a `ScopeTemplate`
whose `create()` / `createMap()` return instances carrying extra members `Ext`.
Middleware that attaches per-instance members (like `withHistory`) returns one.

The composition trick is to be **generic over the incoming augmentation**: take
`AugmentedScopeTemplate<Def, InExt>` and return
`AugmentedScopeTemplate<Def, InExt & YourMembers>`. Stacking such middleware
then accumulates everyone's members instead of dropping them:

```ts
import type { AugmentedScopeTemplate } from 'valuse';

function withReset<Def extends Record<string, unknown>, InExt = unknown>(
  template: AugmentedScopeTemplate<Def, InExt>,
): AugmentedScopeTemplate<Def, InExt & { $reset: () => void }> {
  // ...attach `$reset` in onCreate...
  return template as never;
}
```

`withPersistence` and `withDevtools` don't add members; they preserve whatever
augmentation flows through via a `<T extends ScopeTemplate<any>> => T`
passthrough, so a stack like `withPersistence(withActions(...))` keeps the
actions typed.
