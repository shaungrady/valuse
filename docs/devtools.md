# Redux DevTools

`withDevtools` and its companion connectors wire scopes, maps, and standalone
values up to the
[Redux DevTools Extension](https://github.com/reduxjs/redux-devtools). You get
an action timeline, state snapshots, and time travel — without any Redux in your
app.

```ts
import { valueScope, value } from 'valuse';
import { withDevtools } from 'valuse/middleware';

const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
});

const debugPerson = withDevtools(person, { name: 'person' });
const bob = debugPerson.create({ firstName: 'Bob', lastName: 'Jones' });

bob.firstName.set('Robert'); // shows up as set:firstName in the timeline
```

## Table of contents

- [withDevtools](#withdevtools)
- [connectMapDevtools](#connectmapdevtools)
- [connectDevtools](#connectdevtools)
- [Options](#options)
- [Action names and payloads](#action-names-and-payloads)
- [Time travel](#time-travel)
- [Production behavior](#production-behavior)
- [When the extension isn't installed](#when-the-extension-isnt-installed)

---

## withDevtools

Wraps a `ScopeTemplate`. Every instance you create from the wrapped template
gets its own DevTools connection, keyed by `options.name`:

```ts
const debugPerson = withDevtools(person, {
  name: 'person',
  maxAge: 50,
});

debugPerson.create({ firstName: 'Bob' }); // shown as a "person" instance
debugPerson.create({ firstName: 'Alice' }); // a separate "person" entry
```

Each instance dispatches an `@@INIT`-like init state on `onCreate` and an action
per change on `onChange`. Time travel calls `$setSnapshot` to replay historical
states.

## connectMapDevtools

For a `ScopeMap`, use `connectMapDevtools` instead — it subscribes to the key
list and each instance, emitting a single timeline that shows adds, deletes, and
per-instance changes:

```ts
import { connectMapDevtools } from 'valuse/middleware';

const todos = todoTemplate.createMap();
const disconnect = connectMapDevtools(todos, { name: 'todos' });

// Later, to tear down:
disconnect();
```

Action types:

| Action type      | When                                     |
| ---------------- | ---------------------------------------- |
| `add:<key>`      | `map.set(key, …)` added a new instance   |
| `delete:<key>`   | `map.delete(key)` removed an instance    |
| `instance:<key>` | A field on the instance at `key` changed |

The state snapshot contains a `_keys` array plus one entry per key.

## connectDevtools

For a standalone `Value<T>`:

```ts
import { value } from 'valuse';
import { connectDevtools } from 'valuse/middleware';

const count = value(0);
const disconnect = connectDevtools(count, { name: 'count' });

count.set(1); // action { type: 'set', payload: { from: 0, to: 1 } }
```

## Options

```ts
interface DevtoolsOptions {
  /** Name shown in the DevTools instance selector. Required. */
  name: string;

  /** Maximum number of actions to keep in the timeline. Default: 50. */
  maxAge?: number;

  /** Filter which fields appear in state. Default: all. */
  fields?: string[];

  /** Disable in production. Default: true in production, false otherwise. */
  enabled?: boolean;
}
```

`fields` narrows both the snapshot sent on init and the snapshot sent on every
change. Useful for hiding large blobs or derived data from the timeline without
removing them from the scope.

## Action names and payloads

For `withDevtools`, changes are batched through `onChange`. Each batch becomes
one action:

| Part      | Shape                                                    |
| --------- | -------------------------------------------------------- |
| `type`    | `set:<field>[,<field>…]` — sorted by change order        |
| `payload` | `{ [field]: { from, to } }` for every field that changed |
| `state`   | Filtered `$getSnapshot()` of the instance                |

So a `$setSnapshot({ firstName: 'Bob', lastName: 'Jones' })` produces one action
with type `set:firstName,lastName` and a two-entry payload.

## Time travel

The DevTools panel includes a "jump to state" slider. When the user jumps, the
extension dispatches a `DISPATCH` message with the historical state. The
middleware calls `$setSnapshot(state)` on the instance, which restores every
field in a single atomic batch.

For `connectMapDevtools`, the jump reconciles the key list: missing keys are
added with their stored data, current keys that aren't in the snapshot are
deleted, and overlapping keys get `$setSnapshot` called on them.

Time travel bypasses `beforeChange` — it's a state restoration, not a user
mutation.

## Production behavior

By default, `withDevtools` is a no-op in production:

```ts
if (options.enabled === false) return template; // explicitly off
if (options.enabled === true) return template; // explicitly on
// otherwise, enabled iff NODE_ENV !== 'production'
```

You can force it on or off with the `enabled` flag. When disabled, the
middleware returns the original template untouched — no instrumentation
overhead.

## When the extension isn't installed

If the Redux DevTools browser extension isn't available (normal user in
production, or an SSR render), `withDevtools` and the connect helpers return the
untouched template or a no-op disconnect function. Safe to leave in place.
