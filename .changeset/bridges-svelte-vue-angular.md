---
'valuse': minor
---

add Svelte, Vue, and Angular bridges

New optional entry points adapt any reactive valuse source (`value`,
collections, or a scope instance) into each framework's native reactivity:

- `valuse/svelte` — `toStore` (read-only) and `toWritableStore` (two-way) for
  `$store` syntax and `bind:value`.
- `valuse/vue` — `useValuse` (read-only ref) and `useValuseModel` (writable ref
  for `v-model`), with automatic cleanup via `onScopeDispose`.
- `valuse/angular` — `valuseSignal`, a read-only signal cleaned up through
  `DestroyRef` (or a provided `Injector`).

Each framework is an optional peer dependency, so importing one bridge never
pulls in the others.
