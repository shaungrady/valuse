---
'valuse': minor
---

Add `withActions` middleware for typed, imperative scope actions, and a reusable
`AugmentedScopeTemplate<Def, Ext>` core type.

`withActions(template, ...layers)` attaches named methods to each instance. Each
action is `({ scope, signal, onCleanup }) => (...args) => result` — `scope` is
the live instance (fields, derivations, `$`-methods, prior augmentations),
`signal` aborts on `$destroy`, and `onCleanup` registers teardown scoped to the
current invocation (running on settle or destroy, exactly once). Actions are
declared in ordered layers; a later layer can call earlier layers' actions,
fully typed (up to 11 layers). Names that collide with existing members, or
start with `$`, throw on `create()`.

`AugmentedScopeTemplate<Def, Ext>` is the instance-augmentation channel
middleware use to add typed members to `create()`/`createMap()`. Middleware
generic over an incoming augmentation compose without dropping each other's
members, so `withActions(withHistory(template))` yields instances carrying both
the actions and undo/redo. `HistoryTemplate` is now an alias of it.
