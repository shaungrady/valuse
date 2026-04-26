# Example: Todo App

A classic todo app, built with ValUse scopes. Each todo is a structured reactive
model — not a bag of atoms or a slice of a global store.

## The model

```ts
import { value, valueScope } from 'valuse';

const todo = valueScope(
  {
    id: value<string>(),
    text: value<string>().pipe((v) => v.trim()),
    completed: value<boolean>(false),
    createdAt: value<number>(0),

    label: ({ scope }) =>
      scope.completed.use() ?
        `[x] ${scope.text.use()}`
      : `[ ] ${scope.text.use()}`,
  },
  {
    onCreate: ({ scope }) => {
      // Only set if not already provided (e.g., hydrated from localStorage)
      if (!scope.createdAt.get()) scope.createdAt.set(Date.now());
    },
    onChange: ({ scope }) => {
      localStorage.setItem(
        `todo:${scope.id.get()}`,
        JSON.stringify(scope.$getSnapshot()),
      );
    },
  },
);

// The collection
const todos = todo.createMap();
```

That's it. Each todo has typed fields, a derived label, auto-timestamping on
create, and a hook point for persistence. No reducers, no actions, no selectors.

## Adding todos

```ts
todos.set('todo-1', { id: 'todo-1', text: 'Buy milk' });
todos.set('todo-2', { id: 'todo-2', text: 'Write docs', completed: true });
```

`set` on a collection creates a new instance if the key doesn't exist, or
updates the existing one if it does. No `addTodo` action needed.

## React components

```tsx
import { value, valueScope } from 'valuse';
import { pipeEnum } from 'valuse/utils';

// Filter lives outside the collection, it's app-level state.
// pipeEnum narrows to the allowed set and falls back to the first entry
// if something invalid comes in from the URL or stored state.
const filter = value('all').pipe(
  pipeEnum(['all', 'active', 'completed'] as const),
);

function TodoList() {
  // Re-renders when the key list or filter changes,
  // but NOT when a todo's text or completed status is edited.
  const keys = todos.useKeys();
  const [currentFilter] = filter.use();

  const visible = keys.filter((id) => {
    const todo = todos.get(id)!;
    if (currentFilter === 'active') return !todo.completed.get();
    if (currentFilter === 'completed') return todo.completed.get();
    return true;
  });

  return (
    <ul>
      {visible.map((id) => (
        <TodoItem key={id} id={id} />
      ))}
    </ul>
  );
}

function TodoItem({ id }: { id: string }) {
  // Each field subscription is independent.
  // Editing todo-2 never re-renders todo-1.
  const todo = todos.get(id)!;
  const [completed, setCompleted] = todo.completed.use();
  const [text] = todo.text.use();

  return (
    <li>
      <input
        type="checkbox"
        checked={completed}
        onChange={() => setCompleted((prev) => !prev)}
      />
      <span
        style={{
          textDecoration: completed ? 'line-through' : 'none',
        }}
      >
        {text}
      </span>
    </li>
  );
}

function AddTodo() {
  const [text, setText] = value('').use();

  const add = () => {
    if (!text.trim()) return;
    const id = crypto.randomUUID();
    todos.set(id, { id, text });
    setText('');
  };

  return (
    <div>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={add}>Add</button>
    </div>
  );
}

function Footer() {
  // Re-renders when the key list changes (add/remove),
  // but a checkbox toggle doesn't trigger a recount.
  const keys = todos.useKeys();
  const [currentFilter, setFilter] = filter.use();

  const activeCount = keys.filter(
    (id) => !todos.get(id)!.completed.get(),
  ).length;

  return (
    <footer>
      <span>{activeCount} items left</span>
      <button onClick={() => setFilter('all')}>All</button>
      <button onClick={() => setFilter('active')}>Active</button>
      <button onClick={() => setFilter('completed')}>Completed</button>
    </footer>
  );
}
```

No context providers, no store setup, no boilerplate. Import, define, use.

## Bulk operations

```ts
// Mark all as completed
for (const todo of todos.values()) {
  todo.completed.set(true);
}

// Clear completed
for (const [id, todo] of todos.entries()) {
  if (todo.completed.get()) {
    todos.delete(id);
  }
}
```

## Persistence

The `onChange` in the model above shows the primitive: a per-todo key derived
from `id`, written on every change. That pattern works for any per-instance
storage scheme (a row per todo in IndexedDB, say).

For single-scope persistence (not per-item), the shipped `withPersistence`
middleware handles it end-to-end, including hydration on create, throttled
writes, and cross-tab sync:

```ts
import { withPersistence, localStorageAdapter } from 'valuse/middleware';

const appState = withPersistence(
  valueScope({
    filter: value('all').pipe(
      pipeEnum(['all', 'active', 'completed'] as const),
    ),
    lastViewedId: value<string | null>(null),
  }),
  { key: 'todo-app', adapter: localStorageAdapter, throttle: 200 },
);
```

See [docs/persistence.md](../docs/persistence.md) for adapters (localStorage,
sessionStorage, IndexedDB) and options.

## Why not Zustand?

Zustand would put all todos in a single store object:

```ts
// Zustand
const useTodoStore = create((set, get) => ({
  todos: {} as Record<string, Todo>,
  addTodo: (id: string, text: string) =>
    set((s) => ({ todos: { ...s.todos, [id]: { text, completed: false } } })),
  toggleTodo: (id: string) =>
    set((s) => ({
      todos: {
        ...s.todos,
        [id]: { ...s.todos[id], completed: !s.todos[id].completed },
      },
    })),
}));
```

Every mutation spreads the entire `todos` object. Selectors are required to
avoid re-rendering every row on every change. There's no per-item lifecycle, no
derived state without manual memoization, and no structure beyond "it's in the
store."

## Why not Jotai?

Jotai scatters atoms without structure:

```ts
// Jotai
const todosAtom = atom<Record<string, { text: string; completed: boolean }>>(
  {},
);
const todoIdsAtom = atom((get) => Object.keys(get(todosAtom)));
const todoAtom = atomFamily((id: string) =>
  atom(
    (get) => get(todosAtom)[id],
    (get, set, update: Partial<Todo>) =>
      set(todosAtom, {
        ...get(todosAtom),
        [id]: { ...get(todosAtom)[id], ...update },
      }),
  ),
);
```

Each field access requires deriving a new atom or using `selectAtom`. There's no
concept of "a todo" as a unit — it's atoms all the way down. Adding lifecycle
(auto-persist, timestamps) means wrapping atoms in custom hooks with
`useEffect`.
