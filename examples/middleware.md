# Example: Middleware

ValUse scopes compose via `extend()`. Since `extend()` takes a scope and returns
a scope, middleware is just a function that adds state and behavior. This
example builds a custom `withSoftDelete` middleware, then shows how the shipped
middleware (`withHistory`, `withPersistence`, `withDevtools`) stack on top.

All examples build on the [todo app](./todo-app.md).

## Writing custom middleware with extend()

Don't remove todos immediately, mark them as deleted so users can undo:

```ts
import { value, valueScope, type ScopeTemplate } from 'valuse';

const withSoftDelete = <T extends ScopeTemplate<any>>(scope: T) =>
  scope.extend({
    isDeleted: value<boolean>(false),
    deletedAt: value<number | null>(null),
  });

// Apply to the todo scope.
// `todo` is fully typed, has all base fields plus isDeleted, deletedAt.
const todo = withSoftDelete(
  valueScope({
    id: value<string>(),
    text: value<string>().pipe((v) => v.trim()),
    completed: value<boolean>(false),
  }),
);

const todos = todo.createMap();
```

Now "deleting" a todo is a field change, not a collection removal:

```ts
function softDelete(id: string) {
  const todo = todos.get(id);
  todo?.isDeleted.set(true);
  todo?.deletedAt.set(Date.now());
}

function restore(id: string) {
  const todo = todos.get(id);
  todo?.isDeleted.set(false);
  todo?.deletedAt.set(null);
}

// Actually purge after 30 days
function purgeOld() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [id, todo] of todos.entries()) {
    if (todo.isDeleted.get() && (todo.deletedAt.get() ?? 0) < cutoff) {
      todos.delete(id);
    }
  }
}
```

In React, filter them out of the visible list:

```tsx
function TodoList() {
  const keys = todos.useKeys();
  const visible = keys.filter((id) => !todos.get(id)!.isDeleted.get());

  return (
    <ul>
      {visible.map((id) => (
        <TodoItem key={id} id={id} />
      ))}
    </ul>
  );
}
```

That's the whole pattern: a middleware is any function
`(scope) => scope.extend(...)`.

## Undo/redo with shipped `withHistory`

`withHistory` ships in `valuse/middleware`. Like any middleware it takes a scope
template and returns a new one, so it composes cleanly with `withSoftDelete`:

```ts
import { withHistory } from 'valuse/middleware';

const todoWithHistory = withHistory(
  withSoftDelete(
    valueScope({
      id: value<string>(),
      text: value<string>().pipe((v) => v.trim()),
      completed: value<boolean>(false),
    }),
  ),
  { maxDepth: 50, batchMs: 300 },
);

const todos = todoWithHistory.createMap();
```

Each instance now exposes `undo()`, `redo()`, `clearHistory()`, and reactive
`canUndo` / `canRedo`:

```tsx
function TodoEditor({ id }: { id: string }) {
  const todo = todos.get(id)!;
  const [text, setText] = todo.text.use();

  return (
    <div>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button disabled={!todo.canUndo} onClick={todo.undo}>
        Undo
      </button>
      <button disabled={!todo.canRedo} onClick={todo.redo}>
        Redo
      </button>
    </div>
  );
}
```

Notable options:

- `maxDepth` — cap the history stack (default `50`).
- `batchMs` — collapse changes landing within N ms into a single entry, so
  typing produces one undo step per pause rather than per keystroke.
- `fields` — restrict tracking to a subset of fields.

See [docs/history.md](../docs/history.md) for the full API.

## Persistence with `withPersistence`

`withPersistence` syncs state to a storage adapter. Adapters ship for
localStorage, sessionStorage, and IndexedDB:

```ts
import {
  withHistory,
  withPersistence,
  localStorageAdapter,
} from 'valuse/middleware';

const todo = withPersistence(
  withHistory(
    withSoftDelete(
      valueScope({
        id: value<string>(),
        text: value<string>().pipe((v) => v.trim()),
        completed: value<boolean>(false),
      }),
    ),
  ),
  { key: 'todos', adapter: localStorageAdapter, throttle: 250 },
);
```

Ordering matters: persistence wraps history wraps soft-delete. Each layer sees
the fields added by the layers below, so hydration and undo both see
`isDeleted`/`deletedAt`. See [docs/persistence.md](../docs/persistence.md).

## Redux DevTools with `withDevtools`

```ts
import { withDevtools } from 'valuse/middleware';

const todo = withDevtools(todoWithHistory, { name: 'todos' });
```

Every change shows up in the Redux DevTools timeline with time-travel support.
See [docs/devtools.md](../docs/devtools.md).

## When to ship middleware vs. compose inline

The shipped middleware exist because undo, persistence, and devtools show up in
nearly every app and each has subtle correctness details (batching, hydration
suppression, action naming). Custom middleware via `extend()` is the right
choice when the behavior is domain-specific, like `withSoftDelete`,
`withTracking`, `withAuditLog`.

The rule of thumb: if the behavior is _about_ the model (history, persistence,
debugging), reach for shipped middleware. If it's _part of_ the model (flags,
timestamps, derived state), write it with `extend()`.
