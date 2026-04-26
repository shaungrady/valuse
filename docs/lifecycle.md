# Lifecycle Hooks

Lifecycle hooks let you run code at key moments in a [scope](scopes.md)
instance's life: creation, destruction, and subscriber attachment/detachment.
They are defined in the scope config and run automatically as the instance moves
through its lifecycle. For hooks that respond to value changes, see
[Change hooks](change-hooks.md).

## Table of contents

- [Hook overview](#hook-overview)
- [onCreate](#oncreate)
- [onDestroy](#ondestroy)
- [onUsed](#onused)
- [onUnused](#onunused)
- [Cleanup patterns](#cleanup-patterns)
- [Hook ordering](#hook-ordering)
- [Hooks and extend()](#hooks-and-extend)
- [Hooks and ScopeMap](#hooks-and-scopemap)

---

## Hook overview

| Hook        | When it fires                                 | Context                               |
| ----------- | --------------------------------------------- | ------------------------------------- |
| `onCreate`  | Once, after the instance is fully initialized | `{ scope, input, signal, onCleanup }` |
| `onDestroy` | When `$destroy()` is called                   | `{ scope }`                           |
| `onUsed`    | When the first subscriber attaches            | `{ scope, signal, onCleanup }`        |
| `onUnused`  | When the last subscriber detaches             | `{ scope }`                           |

All hooks receive `scope`, which is the instance object. You can read and write
fields on it.

## onCreate

Fires once after the instance is created, with all fields initialized and
derivations running. This is the place for setup work: starting timers,
establishing connections, or computing initial derived state that requires
imperative logic.

```ts
const timer = valueScope(
  {
    elapsed: value(0),
  },
  {
    onCreate: ({ scope, signal, onCleanup }) => {
      const interval = setInterval(() => {
        scope.elapsed.set((prev) => prev + 1);
      }, 1000);
      onCleanup(() => clearInterval(interval));
    },
  },
);
```

`signal` is an `AbortSignal` that aborts when the instance is destroyed. Pass it
to any API that accepts an `AbortSignal` (event listeners, fetch, etc.) for
automatic cleanup. `onCleanup` registers additional cleanup functions for
everything else. You can call both multiple times.

### Timing

`onCreate` runs synchronously at the end of `.create()`. By the time it fires:

- All value fields have their initial values (from defaults or input)
- Sync derivations have computed their initial values
- Async derivations have started their first run
- The instance object is fully formed

This means you can safely read any field in `onCreate`.

## onDestroy

Fires when `$destroy()` is called on the instance. Use it for final cleanup that
does not fit the `onCleanup` pattern, like logging or notifying external
systems:

```ts
const session = valueScope(
  {
    userId: value<string>(),
    startTime: value(Date.now()),
  },
  {
    onDestroy: ({ scope }) => {
      const duration = Date.now() - scope.startTime.get();
      analytics.track('session_ended', {
        userId: scope.userId.get(),
        duration,
      });
    },
  },
);
```

### Ordering during destroy

When `$destroy()` is called:

1. `onCreate` cleanup functions run (in registration order)
2. `onDestroy` fires
3. Internal cleanup (async derivation abort, subscription disposal, factory pipe
   teardown)

After destruction, the instance's fields are still readable but will not produce
new values or notify subscribers.

## onUsed

Fires when the first subscriber attaches to any reactive field in the scope.
This includes `.subscribe()`, `$subscribe()`, and React `.use()` hooks.

`onUsed` is ideal for lazy initialization: only start expensive work when
someone is actually watching:

```ts
const feed = valueScope(
  {
    messages: value<string[]>([]),
  },
  {
    onUsed: ({ scope, signal, onCleanup }) => {
      const ws = new WebSocket('/feed');
      ws.onmessage = (e) => {
        scope.messages.set((prev) => [...prev, e.data]);
      };
      onCleanup(() => ws.close());
    },
  },
);
```

The WebSocket opens only when a component mounts and calls `.use()`, not when
the instance is created.

### Cleanup

`onUsed`'s `signal` aborts and cleanup functions run when the last subscriber
detaches (triggering `onUnused`). If subscribers reattach later, `onUsed` fires
again with a fresh `signal`, context, and new `onCleanup` registrations.

This makes `onUsed`/`onUnused` a natural fit for resources that should be active
only while the instance is being observed.

## onUnused

Fires when the last subscriber detaches from all reactive fields in the scope.

```ts
{
  onUnused: ({ scope }) => {
    console.log('No more watchers for', scope.name.get());
  },
}
```

At this point, `onUsed` cleanup functions have already run. `onUnused` is for
additional teardown or bookkeeping.

If a new subscriber attaches after `onUnused`, the cycle restarts: `onUsed`
fires again.

## Cleanup patterns

### signal and onCleanup for resource management

Both `signal` and `onCleanup` are available in `onCreate` and `onUsed`. Use
`signal` for APIs that accept an `AbortSignal`, and `onCleanup` for everything
else:

```ts
onCreate: ({ scope, signal, onCleanup }) => {
  // Event listener — automatically removed when signal aborts on $destroy()
  window.addEventListener('resize', () => scope.width.set(innerWidth), { signal });

  // Timer — cleaned up on $destroy() via onCleanup
  const interval = setInterval(() => { /* ... */ }, 1000);
  onCleanup(() => clearInterval(interval));
},
```

You can register as many cleanup functions as you need. They run in registration
order.

### Cleanup timing

| Registered in | Runs when                             |
| ------------- | ------------------------------------- |
| `onCreate`    | `$destroy()` is called                |
| `onUsed`      | Last subscriber detaches (`onUnused`) |

This distinction matters. `onCreate` cleanups live for the entire instance
lifetime. `onUsed` cleanups live only while the instance has active subscribers.

### $setSnapshot with recreate

When calling `$setSnapshot(data, { recreate: true })`, the lifecycle reruns:

1. `onCreate` cleanups run
2. `onDestroy` fires
3. Snapshot is applied
4. `onCreate` fires fresh with new `onCleanup` registrations

This is useful for rehydration scenarios where you want to reset all side
effects.

## Hook ordering

When multiple hooks are defined (through [extension](extending.md)), they fire
in definition order: base hooks before extension hooks.

Within a single `$destroy()` call, the full sequence is:

1. `onCreate` cleanups (base, then extension)
2. `onDestroy` (base, then extension)
3. Internal signal/subscription cleanup

Within a subscriber lifecycle cycle:

1. First subscriber attaches
2. `onUsed` fires (base, then extension)
3. Last subscriber detaches
4. `onUsed` cleanups run (base, then extension)
5. `onUnused` fires (base, then extension)

## Hooks and extend()

Lifecycle hooks merge when using `.extend()`. Both the base and extension hooks
fire, base first. See
[Extending scopes — Lifecycle hook merging](extending.md#lifecycle-hook-merging)
for details.

```ts
const base = valueScope(
  { name: value<string>() },
  { onCreate: () => console.log('base') },
);

const ext = base.extend(
  { role: value('viewer') },
  { onCreate: () => console.log('extension') },
);

ext.create({ name: 'Alice' });
// logs: base
// logs: extension
```

## Hooks and ScopeMap

Each instance in a [ScopeMap](scope-map.md) has its own lifecycle. Hooks fire
per-instance:

```ts
const map = template.createMap();
map.set('a', { name: 'Alice' }); // fires onCreate for 'a'
map.set('b', { name: 'Bob' }); // fires onCreate for 'b'
map.delete('a'); // fires onDestroy for 'a'
map.clear(); // fires onDestroy for 'b'
```

The ScopeMap itself does not have lifecycle hooks. It only manages the
collection of instances; each instance manages its own lifecycle independently.
