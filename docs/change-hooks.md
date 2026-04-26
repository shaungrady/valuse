# Change Hooks

Change hooks let you intercept and respond to value changes on a scope. There
are two hooks: `beforeChange` runs synchronously before the write and can
prevent it, and `onChange` runs asynchronously after one or more writes are
batched together.

Both hooks receive structured change metadata with per-field and per-group
breakdowns, so you can write targeted reactions without polling or diffing. For
creation/destruction hooks, see [Lifecycle](lifecycle.md).

## Table of contents

- [onChange](#onchange)
- [beforeChange](#beforechange)
- [Change records](#change-records)
- [changesByScope](#changesbyscope)
- [Preventing changes](#preventing-changes)
- [Batching behavior](#batching-behavior)
- [Per-field subscribe](#per-field-subscribe)
- [Whole-scope subscribe](#whole-scope-subscribe)
- [Combining hooks and subscriptions](#combining-hooks-and-subscriptions)

---

## onChange

`onChange` fires on a microtask after one or more value fields change. Multiple
synchronous writes are batched into a single call:

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    lastUpdated: value(0),
  },
  {
    onChange: ({ scope, changes, changesByScope }) => {
      console.log(`${changes.size} field(s) changed`);
    },
  },
);
```

The context object contains:

| Property         | Type                       | Description                              |
| ---------------- | -------------------------- | ---------------------------------------- |
| `scope`          | Instance root              | The scope instance (for reading values)  |
| `changes`        | `Set<Change>`              | All changes in this batch                |
| `changesByScope` | `Map<ScopeNode, Change[]>` | Changes grouped by field and group nodes |

Because `onChange` fires asynchronously, the values on the instance already
reflect the new state. You can read them normally or use the `Change` records to
see what moved from where.

## beforeChange

`beforeChange` fires synchronously, before the value is actually written. This
gives you a chance to prevent the change entirely:

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    age: value(0),
  },
  {
    beforeChange: ({ changes, prevent }) => {
      for (const change of changes) {
        if (change.path === 'age' && (change.to as number) < 0) {
          prevent(change); // block negative ages
        }
      }
    },
  },
);
```

The context object is the same as `onChange` plus a `prevent()` function:

| Property         | Type                       | Description                            |
| ---------------- | -------------------------- | -------------------------------------- |
| `scope`          | Instance root              | The scope instance                     |
| `changes`        | `Set<Change>`              | The changes about to be applied        |
| `changesByScope` | `Map<ScopeNode, Change[]>` | Changes grouped by scope node          |
| `prevent`        | `(target?) => void`        | Block a change, a group, or everything |

Since `beforeChange` runs synchronously before the write, the instance still
holds the old values. Derivations never see prevented values.

## Change records

Each change is a `Change<T>` object:

```ts
interface Change<T = unknown> {
  readonly scope: ScopeNode; // the field's wrapper object
  readonly path: string; // dot-separated path, e.g. 'job.title'
  readonly from: T; // previous value
  readonly to: T; // new value
}
```

The `path` string is useful for logging and pattern matching. The `scope`
reference is useful for programmatic checks (see
[changesByScope](#changesbyscope)).

## changesByScope

`changesByScope` groups changes by scope node. Every change appears under its
own field node, its parent group, its grandparent group, and so on up to the
root. This makes it easy to check whether a particular subtree changed:

```ts
const employee = valueScope(
  {
    name: value<string>(),
    job: {
      title: value<string>(),
      salary: value(0),
    },
  },
  {
    onChange: ({ scope, changesByScope }) => {
      // Did anything in the job group change?
      if (changesByScope.has(scope.job)) {
        console.log('job changed:', changesByScope.get(scope.job));
      }

      // Did a specific field change?
      if (changesByScope.has(scope.name)) {
        console.log('name changed');
      }
    },
  },
);
```

The root scope node always contains all changes. Group nodes contain all changes
from their children. Individual field nodes contain only their own change.

## Preventing changes

`prevent()` in `beforeChange` has three forms:

```ts
beforeChange: ({ scope, changes, prevent }) => {
  // Prevent a specific change
  for (const change of changes) {
    if (change.to === '') prevent(change);
  }

  // Prevent all changes under a group node
  prevent(scope.job);

  // Prevent everything (no argument)
  prevent();
},
```

When a change is prevented:

- The value is not written to the signal
- Subscribers are not notified
- `onChange` does not see the prevented change
- Derivations that depend on the field do not recompute

Preventing is all-or-nothing per field. You cannot modify the incoming value;
either allow it or block it.

## Batching behavior

`onChange` is batched by default. When multiple fields change synchronously, you
get a single `onChange` call with all changes in the `changes` set:

```ts
import { batchSets } from 'valuse';

batchSets(() => {
  bob.firstName.set('Robert');
  bob.lastName.set('Smith');
});
// onChange fires once with 2 changes
```

Even without explicit `batchSets`, assignments in the same synchronous turn are
batched because `onChange` fires on a microtask. For more on batching semantics,
see [Reactive Values — Batching writes](reactive-values.md#batching-writes).

`beforeChange` is not batched. It fires once per `.set()` call, synchronously,
before the write. This is intentional: prevention decisions need to happen
before the value changes, not after a batch settles.

## Per-field subscribe

Outside of scope config hooks, each reactive field has its own `.subscribe()`:

```ts
bob.firstName.subscribe((value, previous) => {
  console.log(`Name changed: ${previous} → ${value}`);
});
```

Per-field subscriptions:

- Fire only when that specific field changes
- Receive the new value and the previous value
- Return an unsubscribe function
- Skip the initial value (fire only on subsequent changes)

## Whole-scope subscribe

`$subscribe()` fires when any reactive field in the scope changes:

```ts
const unsub = bob.$subscribe(() => {
  console.log('something changed on bob');
});
```

The callback receives no arguments. If you need to know what changed, use
`onChange` instead, or read the fields you care about inside the callback.

`$subscribe()` uses a single Preact effect that tracks all signals in the scope,
so the overhead is constant regardless of how many fields the scope has.

## Combining hooks and subscriptions

Hooks and subscriptions serve different purposes:

| Mechanism        | Timing            | Scope      | Use case                          |
| ---------------- | ----------------- | ---------- | --------------------------------- |
| `beforeChange`   | Sync, pre-write   | All fields | Validation, access control        |
| `onChange`       | Async, post-write | All fields | Side effects, logging, sync       |
| `.subscribe(fn)` | Sync, post-write  | One field  | Targeted reactions                |
| `$subscribe(fn)` | Sync, post-write  | All fields | React integration, broad watchers |

They can all be active at the same time. The ordering is:

1. `beforeChange` fires (can prevent)
2. Signal updates (if not prevented)
3. Per-field `.subscribe()` fires
4. `$subscribe()` fires
5. `onChange` fires (on next microtask)
