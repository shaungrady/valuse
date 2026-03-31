# Example: Todo App

A classic todo app, built with ValUse scopes. Each todo is a structured reactive
model — not a bag of atoms or a slice of a global store.

## The model

```ts
import { value, valueScope } from "valuse";

const todo = valueScope(
  {
    id: value<string>(),
    text: value<string>().pipe((v) => v.trim()),
    completed: value<boolean>(false),
    createdAt: value<number>(0),

    label: ({ use }) =>
      use("completed") ? `[x] ${use("text")}` : `[ ] ${use("text")}`,
  },
  {
    onInit: ({ set }) => {
      // Only set if not already provided (e.g., hydrated from localStorage)
      if (!get("createdAt")) set("createdAt", Date.now());
    },
    onChange: ({ changes, set, get, getSnapshot }) => {
      localStorage.setItem(`todo:${get("id")}`, JSON.stringify(getSnapshot()));
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
todos.set("todo-1", { id: "todo-1", text: "Buy milk" });
todos.set("todo-2", { id: "todo-2", text: "Write docs", completed: true });
```

`set` on a collection creates a new instance if the key doesn't exist, or
updates the existing one if it does. No `addTodo` action needed.

## React components

```tsx
import { value, valueScope } from "valuse/react";

// Filter lives outside the collection — it's app-level state
const filter = value<"all" | "active" | "completed">("all");

function TodoList() {
  // Re-renders when the key list or filter changes,
  // but NOT when a todo's text or completed status is edited.
  const keys = todos.useKeys();
  const [currentFilter] = filter.use();

  const visible = keys.filter((id) => {
    const todo = todos.get(id)!;
    if (currentFilter === "active") return !todo.get("completed");
    if (currentFilter === "completed") return todo.get("completed");
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
  // todos.use(id) subscribes to this single todo's scope instance.
  // Editing todo-2 never re-renders todo-1.
  const [get, set] = todos.use(id);

  return (
    <li>
      <input
        type="checkbox"
        checked={get("completed")}
        onChange={() => set("completed", (prev) => !prev)}
      />
      <span
        style={{ textDecoration: get("completed") ? "line-through" : "none" }}
      >
        {get("text")}
      </span>
    </li>
  );
}

function AddTodo() {
  const [text, setText] = value("").use();

  const add = () => {
    if (!text.trim()) return;
    const id = crypto.randomUUID();
    todos.set(id, { id, text });
    setText("");
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
    (id) => !todos.get(id)!.get("completed"),
  ).length;

  return (
    <footer>
      <span>{activeCount} items left</span>
      <button onClick={() => setFilter("all")}>All</button>
      <button onClick={() => setFilter("active")}>Active</button>
      <button onClick={() => setFilter("completed")}>Completed</button>
    </footer>
  );
}
```

No context providers, no store setup, no boilerplate. Import, define, use.

## Bulk operations

```ts
// Mark all as completed
for (const todo of todos.values()) {
  todo.set("completed", true);
}

// Clear completed
for (const [id, todo] of todos.entries()) {
  if (todo.get("completed")) {
    todos.delete(id);
  }
}
```

## Persistence with onChange

The `onChange` in the model above persists per-todo via `getSnapshot()`. For
bulk save/load of the whole collection:

```ts
function saveTodos() {
  const data: Record<string, unknown> = {};
  for (const [id, todo] of todos.entries()) {
    data[id] = todo.getSnapshot();
  }
  localStorage.setItem("todos", JSON.stringify(data));
}

function loadTodos() {
  const raw = localStorage.getItem("todos");
  if (!raw) return;
  for (const [id, fields] of Object.entries(JSON.parse(raw))) {
    todos.set(id, fields as any);
  }
}
```

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
