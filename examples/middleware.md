# Example: Middleware

ValUse scopes compose via `extend()`. Since `extend()` takes a scope and
returns a scope, middleware is just a function that adds state and behavior.
This example shows two middleware patterns applied to the
[todo app](./todo-app.md).

## Soft delete

Don't remove todos immediately — mark them as deleted so users can undo:

```ts
import { value, valueScope, type ScopeTemplate } from "valuse";

const withSoftDelete = <T extends ScopeTemplate<any>>(scope: T) =>
  scope.extend({
    isDeleted: value<boolean>(false),
    deletedAt: value<number | null>(null),
  });

// Apply to the todo scope.
// `todo` is fully typed — has all base fields plus isDeleted, deletedAt.
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
  // Bulk set merges — only touches the provided keys.
  // text, completed, id are untouched.
  todo?.set({ isDeleted: true, deletedAt: Date.now() });
}

function restore(id: string) {
  const todo = todos.get(id);
  todo?.set({ isDeleted: false, deletedAt: null });
}

// Actually purge after 30 days
function purgeOld() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [id, todo] of todos.entries()) {
    if (todo.get("isDeleted") && (todo.get("deletedAt") ?? 0) < cutoff) {
      todos.delete(id);
    }
  }
}
```

In React, filter them out of the visible list:

```tsx
function TodoList() {
  const keys = todos.useKeys();
  const visible = keys.filter((id) => !todos.get(id)!.get("isDeleted"));

  return (
    <ul>
      {visible.map((id) => (
        <TodoItem key={id} id={id} />
      ))}
    </ul>
  );
}
```

## Undo/redo history

This one is more interesting. The history itself shouldn't live inside the
scope — if it did, `getSnapshot()` would capture the history array, and
restoring a snapshot would overwrite the history. Instead, history wraps the
instance from the outside:

```ts
interface History<T> {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** The wrapped instance — use normally */
  instance: T;
}

function withHistory<Def extends Record<string, any>>(
  instance: ScopeInstance<Def>,
): History<ScopeInstance<Def>> {
  const snapshots: ReturnType<typeof instance.getSnapshot>[] = [];
  let index = -1;
  let restoring = false;

  // Capture initial state
  snapshots.push(instance.getSnapshot());
  index = 0;

  // On every change, push a new snapshot
  instance.subscribe(() => {
    if (restoring) return; // Don't record history during undo/redo

    // Discard any redo stack
    snapshots.length = index + 1;
    snapshots.push(instance.getSnapshot());
    index++;
  });

  return {
    instance,
    undo: () => {
      if (index <= 0) return;
      index--;
      restoring = true;
      instance.setSnapshot(snapshots[index]);
      restoring = false;
    },
    redo: () => {
      if (index >= snapshots.length - 1) return;
      index++;
      restoring = true;
      instance.setSnapshot(snapshots[index]);
      restoring = false;
    },
    canUndo: () => index > 0,
    canRedo: () => index < snapshots.length - 1,
  };
}
```

### Usage

```ts
const todo = valueScope({
  text: value<string>(),
  completed: value<boolean>(false),
});

const inst = todo.create({ text: "Buy milk" });
const { instance, undo, redo } = withHistory(inst);

instance.set("text", "Buy oat milk");
instance.set("completed", true);

undo();
instance.get("completed"); // false
instance.get("text"); // "Buy oat milk"

undo();
instance.get("text"); // "Buy milk"

redo();
instance.get("text"); // "Buy oat milk"
```

### In React

```tsx
function TodoEditor({ id }: { id: string }) {
  const todo = todos.get(id)!;
  const history = useMemo(() => withHistory(todo), [todo]);

  const [get, set] = history.instance.use();

  return (
    <div>
      <input value={get("text")} onChange={(e) => set("text", e.target.value)} />
      <button disabled={!history.canUndo()} onClick={history.undo}>
        Undo
      </button>
      <button disabled={!history.canRedo()} onClick={history.redo}>
        Redo
      </button>
    </div>
  );
}
```

### Why history is a wrapper, not extend()

`extend()` is great when the new state is part of the model — soft delete,
timestamps, flags. History is different: it's _about_ the model, not _in_ it.
If history lived inside the scope:

- `getSnapshot()` would include the history array — snapshots containing
  snapshots
- Restoring via `setSnapshot()` would overwrite the history itself
- `onChange` would fire for history bookkeeping, polluting the change log

The wrapper pattern keeps history orthogonal. The instance doesn't know it's
being tracked. This is the right boundary: **`extend()` for domain state,
wrappers for meta-behavior.**

## Composing middleware

Stack them:

```ts
const todo = withSoftDelete(
  valueScope({
    id: value<string>(),
    text: value<string>().pipe((v) => v.trim()),
    completed: value<boolean>(false),
  }),
);

const todos = todo.createMap();

// Per-instance history on a specific todo
const bobTodo = todos.get("bob")!;
const { instance, undo, redo } = withHistory(bobTodo);
```

Or apply history to the whole collection by wrapping each instance on creation:

```ts
const histories = new Map<string, History<ScopeInstance<typeof todo>>>();

function addTodo(id: string, text: string) {
  todos.set(id, { id, text });
  histories.set(id, withHistory(todos.get(id)!));
}

function undoTodo(id: string) {
  histories.get(id)?.undo();
}
```

This is intentionally explicit. Undo/redo is a UI concern — not every instance
needs it, and the granularity (per-field? per-instance? per-collection?)
depends on the product. ValUse gives you the primitives; you choose the scope.
