# valueRef — Scope Composition

`valueRef()` brings external reactive state into a scope definition. Instead of
copying values, a ref points to a live source. All instances of the scope read
from the same source (shared refs) or each get their own (factory refs).

Refs are the primary composition mechanism in ValUse. Rather than deeply
[nesting scopes](scopes.md#nesting) or passing props, you connect independent
pieces of state through refs and let the reactive graph handle updates.

## Table of contents

- [Shared refs](#shared-refs)
- [Factory refs](#factory-refs)
- [Reactivity through refs](#reactivity-through-refs)
- [Ref sources](#ref-sources)
- [Refs to scope instances](#refs-to-scope-instances)
- [Transitive lifecycle](#transitive-lifecycle)
- [Patterns](#patterns)

---

## Shared refs

The simplest form of ref points to a shared reactive source. Every instance of
the scope reads from the same value:

```ts
import { value, valueRef, valueScope, valueSet } from 'valuse';

const currentUser = value<string>('anonymous');
const globalTags = valueSet(['admin', 'root']);

const widget = valueScope({
  label: value<string>(),
  user: valueRef(currentUser),
  tags: valueRef(globalTags),
});

const a = widget.create({ label: 'Widget A' });
const b = widget.create({ label: 'Widget B' });

a.user.get(); // 'anonymous'
b.user.get(); // 'anonymous' — same source

currentUser.set('alice');
a.user.get(); // 'alice'
b.user.get(); // 'alice' — both updated
```

Refs are read-only on the instance. To write, use the original source directly.

## Factory refs

When each instance needs its own independent state, pass a factory function to
`valueRef()`. The factory is called once per `.create()`:

```ts
const column = valueScope({
  id: value<string>(),
  name: value<string>(),
});

const board = valueScope({
  boardId: value<string>(),
  columns: valueRef(() => column.createMap()),
});

const boardA = board.create({ boardId: 'a' });
const boardB = board.create({ boardId: 'b' });

// Each board gets its own independent ScopeMap
boardA.columns.get(); // Map {}
boardB.columns.get(); // Map {} — different instance
```

Factory refs are useful for composition patterns where each parent instance owns
a child collection or nested scope.

## Reactivity through refs

Derivations can read through refs using `.use()`. Reactivity flows through the
ref boundary:

```ts
const board = valueScope({
  boardId: value<string>(),
  columns: valueRef(() => column.createMap()),

  columnCount: ({ scope }) => scope.columns.use().size,
});

const inst = board.create({ boardId: 'main' });
inst.columnCount.get(); // 0

inst.columns.set('col1', { id: 'col1', name: 'Todo' });
inst.columnCount.get(); // 1
```

When `columns` changes (entries added or removed), `columnCount` recomputes
automatically. The reactive graph does not care that the data comes from a ref;
`.use()` tracks the dependency the same way.

## Ref sources

`valueRef()` accepts several source types:

| Source type     | What `.get()` returns          |
| --------------- | ------------------------------ |
| `Value<T>`      | The value's current output     |
| `ValueSet<T>`   | The current `Set<T>`           |
| `ValueMap<K,V>` | The current `Map<K,V>`         |
| Scope instance  | The instance's `$get()` result |
| `{ get(): T }`  | Whatever `.get()` returns      |
| `() => T`       | Factory, called per instance   |

```ts
// Value
valueRef(value('hello'));

// ValueSet
valueRef(valueSet(['a', 'b']));

// ValueMap
valueRef(valueMap([['x', 1]]));

// Any object with .get()
valueRef({ get: () => computeExpensiveThing() });

// Factory
valueRef(() => valueMap());
```

## Refs to scope instances

You can ref an entire scope instance. Outside a derivation, the ref's `.get()`
returns the instance's snapshot. Inside a derivation, `scope.<ref>.use()` hands
back the referenced instance itself, so you can reach into its fields with the
usual `.get()` / `.use()` pattern:

```ts
const settings = valueScope({
  theme: value('dark'),
  locale: value('en'),
});

const globalSettings = settings.create({ theme: 'light' });

const app = valueScope({
  settings: valueRef(globalSettings),
  greeting: ({ scope }) =>
    scope.settings.use().locale.get() === 'en' ? 'Hello' : 'Hola',
});
```

This is useful for sharing configuration or global state across multiple scope
types without coupling their definitions.

## Transitive lifecycle

Lifecycle hooks flow through ref boundaries. When a scope instance transitions
to "used" (its first subscriber attaches), all scopes it references via
`valueRef()` also become "used." This activates their `onUsed` hooks and async
derivations.

When the last subscriber detaches, referenced scopes receive `onUnused` as well.

```ts
const dataSource = valueScope(
  {
    data: value<string[]>([]),
  },
  {
    onUsed: ({ scope, onCleanup }) => {
      const ws = new WebSocket('/feed');
      ws.onmessage = (e) => scope.data.set(JSON.parse(e.data));
      onCleanup(() => ws.close());
    },
  },
);

const sharedSource = dataSource.create();

const dashboard = valueScope({
  source: valueRef(sharedSource),
  count: ({ scope }) => scope.source.use().data.get().length,
});

const inst = dashboard.create();
// When dashboard gets its first subscriber, sharedSource's onUsed fires
// and the WebSocket opens.
```

This means you can define data sources as standalone scopes with `onUsed`
activation, then compose them into larger scopes via refs. The lifecycle
management is automatic. For full details on `onUsed`/`onUnused`, see
[Lifecycle — onUsed](lifecycle.md#onused).

## Patterns

### Global state injection

```ts
const authState = value<{ userId: string; role: string } | null>(null);

const protectedScope = valueScope({
  auth: valueRef(authState),
  isAdmin: ({ scope }) => scope.auth.use()?.role === 'admin',
});
```

### Per-instance child collections

```ts
const todoList = valueScope({
  name: value<string>(),
  items: valueRef(() => todoItem.createMap()),
  count: ({ scope }) => scope.items.use().size,
  completed: ({ scope }) =>
    scope.items
      .use()
      .values()
      .filter((i) => i.done.get()).length,
});
```

### Shared configuration

```ts
const theme = value<'light' | 'dark'>('light');

const widget = valueScope({
  theme: valueRef(theme),
  content: value<string>(),
  className: ({ scope }) =>
    scope.theme.use() === 'dark' ? 'widget-dark' : 'widget-light',
});
```

### Cross-scope communication

```ts
const eventBus = valueMap<string, unknown>();

const producer = valueScope({
  events: valueRef(eventBus),
  publish:
    ({ scope }) =>
    (type: string, data: unknown) => {
      scope.events.get().set(type, data);
    },
});

const consumer = valueScope({
  events: valueRef(eventBus),
  lastEvent: ({ scope }) => scope.events.use().get('notification'),
});
```
