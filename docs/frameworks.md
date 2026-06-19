# Framework Integration

ValUse is framework-agnostic at its core. Every reactive type — `value`,
collections, schema-validated values, and whole [scope](scopes.md) instances —
exposes the same read + subscribe surface, and the shipped bridges adapt that
surface into each framework's native reactivity.

There's a bridge for React, Svelte, Vue, and Angular. Anything else takes a few
lines on top of the universal contract.

## Table of contents

- [The universal contract](#the-universal-contract)
- [React](#react)
- [Svelte](#svelte)
- [Vue](#vue)
- [Angular](#angular)
- [Read vs. two-way binding](#read-vs-two-way-binding)
- [Bridging any other framework](#bridging-any-other-framework)

---

## The universal contract

Two method pairs cover every reactive type:

| Type                                                           | Read              | Subscribe to changes |
| -------------------------------------------------------------- | ----------------- | -------------------- |
| `value`, `valueArray`, `valueSet`, `valueMap`, schema, derived | `.get()`          | `.subscribe(fn)`     |
| Scope instances                                                | `.$getSnapshot()` | `.$subscribe(fn)`    |

Both `subscribe` forms return an [`Unsubscribe`](scopes.md) function and fire
**only on change** — never synchronously on registration. Writable types
(`value`, schema values) additionally expose `.set()`. The bridges are built
entirely on these primitives, so a source created anywhere works in any
framework without special wiring.

> Each bridge is an **optional peer dependency**. Importing `valuse/vue` never
> pulls in React, Svelte, or Angular, and vice versa.

## React

Import `valuse/react` once, anywhere in your app, as a side-effect. It installs
`useSyncExternalStore` so the `.use()` hook on every reactive type re-renders on
change:

```tsx
import 'valuse/react';

function FilterInput({ filter }) {
  const [value, setValue] = filter.use();
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
}
```

`.use()` returns a `[value, setter]` tuple for writable types and `[value]` for
read-only ones. Scope instances expose `.$use()`. Without the import, `.use()`
falls back to a non-reactive snapshot (handy for tests or SSR). See
[Reactive Values → React integration](reactive-values.md#react-integration).

## Svelte

`valuse/svelte` adapts a source into Svelte's store contract, so it works with
the `$store` auto-subscription syntax. Because Svelte expects a store to emit
its current value immediately on subscribe (ValUse's `subscribe` only fires on
change), the adapter pushes the snapshot once up front, then forwards every
change.

```svelte
<script>
  import { toStore, toWritableStore } from 'valuse/svelte';

  // Read-only: any reactive source, including a scope instance.
  const unread = toStore(inbox.unreadCount);

  // Two-way: writable sources (value / schema) support `bind:` and `$x = ...`.
  const name = toWritableStore(user.name);
</script>

{#if $unread > 0}<span class="badge">{$unread}</span>{/if}

<input bind:value={$name} />
```

Svelte unsubscribes automatically when the component using `$store` is
destroyed.

## Vue

`valuse/vue` exposes two composition-API helpers. Call them inside `setup()` (or
an active
[effect scope](https://vuejs.org/api/reactivity-advanced.html#effectscope)) so
the subscription is torn down automatically when the scope is disposed.

```ts
import { useValuse, useValuseModel } from 'valuse/vue';

// Read-only ref that re-renders on change.
const unread = useValuse(inbox.unreadCount); // Readonly<Ref<number>>

// Writable computed ref for v-model on a writable source.
const name = useValuseModel(user.name);
```

```vue
<template>
  <span v-if="unread > 0" class="badge">{{ unread }}</span>
  <input v-model="name" />
</template>
```

`useValuse` accepts any source (including a scope instance, whose snapshot it
tracks); `useValuseModel` requires a writable source. If you call either outside
an effect scope, Vue warns — the subscription would otherwise leak. For an
unscoped lifetime, subscribe to the source directly and manage cleanup yourself.

## Angular

`valuse/angular` adapts a source into a read-only Angular signal. Cleanup is
registered through the current `DestroyRef`, so it must run in an injection
context (a constructor or field initializer):

```ts
import { valuseSignal } from 'valuse/angular';

@Component({
  /* ... */
})
class InboxBadge {
  readonly unread = valuseSignal(inbox.unreadCount); // Signal<number>
}
```

The signal is read-only by design (matching Angular's own `toSignal`); to write,
mutate the source directly — e.g. `inbox.lastReadAt.set(Date.now())`.

To create one outside an injection context, pass an `injector`, or set
`manualCleanup` to opt out of automatic teardown entirely:

```ts
// Lazily, after construction:
const total = valuseSignal(cart.total, { injector: this.injector });

// No DI at all (you own the source's lifetime):
const total = valuseSignal(cart.total, { manualCleanup: true });
```

## Read vs. two-way binding

Most UI state is read in the template and written through explicit handlers, so
the read-only adapters (`toStore`, `useValuse`, `valuseSignal`, `.use()` for
read-only fields) are the common case — just call `source.set(...)` in your
event handlers.

Reach for the two-way helpers (`toWritableStore`, `useValuseModel`, the
`[value, setter]` tuple from `.use()`) when you want a control bound directly to
a writable `value` or schema field via `bind:`/`v-model`. They only accept
writable sources; derived and collection types are read-only through the
bridges, so write to those via the source's own API.

## Bridging any other framework

No dedicated bridge? The universal contract is all you need. For example, Solid:

```ts
import { from } from 'solid-js';

const count = from((set) => {
  set(counter.get()); // seed the initial value
  return counter.subscribe(() => set(counter.get())); // returns the unsubscribe
});
```

The same shape — read once, subscribe, dispose on unmount — bridges vanilla web
components, Qwik, or anything else:

```ts
const unsubscribe = counter.subscribe((value) => {
  element.textContent = String(value);
});
element.textContent = String(counter.get());
// later: unsubscribe();
```

For a scope instance, swap `.get()`/`.subscribe()` for
`.$getSnapshot()`/`.$subscribe()`.
