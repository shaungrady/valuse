# ValUse

_Another_ state library? Yes, but a different kind. State libraries make you
choose: one big store (Zustand) or scattered atoms (Jotai). ValUse gives you
**scopes** — structured, reactive models with typed fields, derived state, and
lifecycle hooks built in, so your state mirrors how your data actually works
instead of how your framework wants it. And creating independent instances
doesn't require factory wrappers or providers.

[**Let's compare.**](examples/comparison.md)

So what kind of stuff does ValUse make easy?

- [Another todo list](examples/todo-app.md), because the world needed one more
- A [form wizard](examples/form-wizard.md) with validation, dynamic fields, and
  cross-step state
- A [real-time stock ticker](examples/stock-ticker.md) with WebSocket feeds (GME
  to the moon)
- A [kanban board](examples/kanban-board.md) with drag-and-drop between columns
- [Middleware](examples/middleware.md) for logging, persistence, undo/redo

Just want to see code? **[Quickstart](QUICKSTART.md)**

## Table of contents

- [Values](#values) — reactive primitives with transforms and custom comparison
- [Collections](#collections) — reactive Set and Map
- [Scopes](#scopes) — structured models with typed fields and derivations
- [Refs](#refs) — share reactive state across scopes
- [Keyed collections of scopes](#keyed-collections-of-scopes) — many instances
  of the same scope
- [Lifecycle](#lifecycle) — onInit, onChange, onUsed/onUnused, onDestroy
- [Extending scopes](#extending-scopes) — derive new scopes, reusable middleware
- [Factories](#factories) — parameterized scope templates
- [Batching](#batching)
- [API reference](#api-reference)

## Values

The building block. A `value` is a single piece of reactive state.

```ts
import { value } from "valuse";

const name = value<string>("Alice");
const count = value<number>(0);
```

Read, write, and subscribe — no framework required:

```ts
name.get(); // 'Alice'
name.set("Bob");
name.set((prev) => prev.toUpperCase()); // callback form
name.subscribe((v) => console.log(v)); // logs on every change
```

In React, `.use()` returns a `[value, setter]` tuple that subscribes and
re-renders on change:

```tsx
const [currentName, setName] = name.use();
```

All `.subscribe()` calls return an unsubscribe function. `.destroy()` tears down
all active subscriptions at once:

```ts
const unsub = name.subscribe((v) => console.log(v));
unsub(); // stop this listener
name.destroy(); // stop all listeners
```

### Transforms

Chain `.pipe()` to normalize values on every `set`. Transforms run in order
before the value is stored:

```ts
const email = value<string>("")
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase());
```

Since pipes are just functions, extract and reuse them:

```ts
const trim = (v: string) => v.trim();
const lower = (v: string) => v.toLowerCase();
const clamp = (min: number, max: number) => (v: number) =>
  Math.max(min, Math.min(max, v));

const email = value<string>("").pipe(trim).pipe(lower);
const age = value<number>(0).pipe(clamp(0, 150));
```

### Custom comparison

By default, values notify subscribers on identity change (`===`). Override with
`.compareUsing()`:

```ts
const user = value<User>({ id: 1, name: "Alice" }).compareUsing(
  (a, b) => a.id === b.id,
);
```

`.pipe()` and `.compareUsing()` work on all value types — `value`, `valueSet`,
and `valueMap`.

## Collections

Reactive versions of the JS data structures you already know. Same interface as
`value` — `.get()`, `.set()`, `.subscribe()`, `.use()`, `.pipe()`,
`.compareUsing()`, `.destroy()`.

### valueSet

```ts
import { valueSet } from "valuse";

const tags = valueSet<string>(["admin", "active"]);

tags.get(); // Set { 'admin', 'active' }
tags.has("admin"); // true
tags.size; // 2

// Mutation callbacks receive a draft — write mutations, get a new immutable Set
tags.set((draft) => draft.add("editor"));
tags.set((draft) => draft.delete("admin"));

// Convenience methods
tags.add("editor");
tags.delete("admin");
tags.clear();
```

In React:

```tsx
const [current, set] = tags.use();
set((t) => t.add("editor"));
```

### valueMap

```ts
import { valueMap } from "valuse";

const scores = valueMap<string, number>([
  ["alice", 95],
  ["bob", 82],
]);

scores.get(); // Map { 'alice' => 95, 'bob' => 82 }
scores.get("alice"); // 95
scores.has("alice"); // true
scores.size; // 2
scores.keys(); // ['alice', 'bob']

scores.set((draft) => draft.set("charlie", 90));
scores.delete("bob");
```

In React, subscribe to the whole map or a single key:

```tsx
const [all, setAll] = scores.use(); // whole map
const [aliceScore, setAlice] = scores.use("alice"); // only re-renders when alice changes
const keys = scores.useKeys(); // only re-renders when keys change
```

## Scopes

A `valueScope` bundles related state and derivations into a reusable template.

```ts
import { value, valueScope } from "valuse";

const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  role: value<string>("viewer"),

  fullName: (get) => `${get("firstName")} ${get("lastName")}`,
});
```

Values called without an argument start as `undefined`. Values called with an
argument start with that default.

### Creating instances

```ts
const bob = person.create({
  firstName: "Bob",
  lastName: "Jones",
  // role defaults to 'viewer'
});

const partial = person.create({ role: "admin" }); // firstName, lastName are undefined
const empty = person.create(); // all undefined or defaults
```

### Reading and writing

```ts
bob.get("firstName"); // 'Bob'
bob.get("fullName"); // 'Bob Jones' — derivations work like any other field

bob.set("role", "admin");
bob.set("role", (prev) => prev.toUpperCase()); // callback form
bob.set({ firstName: "Robert", lastName: "Smith" }); // bulk — omitted fields untouched
```

Only `value()` fields are settable. Derivations and refs are read-only — a
TypeScript error to `set`, silently ignored at runtime.

### Using in React

```tsx
// All fields — re-renders on any change
const [get, set] = bob.use();
get("fullName"); // 'Bob Jones'
set("role", "admin");

// Single field — only re-renders when that field changes
const [firstName, setFirstName] = bob.use("firstName");
const [fullName] = bob.use("fullName"); // derivation — no setter
```

### Snapshots

`getSnapshot()` returns a plain object of the entire scope state — values,
derivations, refs, and passthrough data. One-time read, not reactive:

```ts
bob.getSnapshot();
// { firstName: 'Bob', lastName: 'Jones', role: 'viewer', fullName: 'Bob Jones' }
```

`setSnapshot()` is a full replacement. Omitted keys reset to `undefined`:

```ts
bob.setSnapshot({ firstName: "Alice", lastName: "Smith", role: "admin" });
bob.setSnapshot({ firstName: "Charlie" });
bob.get("lastName"); // undefined — not 'Smith'
```

Use `setSnapshot(data, { rerunInit: true })` to re-fire `onInit` after
restoring.

### Subscribing outside React

```ts
bob.subscribe((get) => {
  console.log(get("fullName"));
});
```

## Refs

Use `valueRef()` to bring external reactive state into a scope. Refs are shared
across all instances — they point to the same source, not a copy:

```ts
import { value, valueRef, valueScope, valueSet } from "valuse";

const globalSpecialTags = valueSet<string>(["admin", "root"]);

const person = valueScope({
  firstName: value<string>(),
  tags: valueSet<string>(),
  specialTags: valueRef(globalSpecialTags),

  hasSpecialTag: (get) => get("tags").some((t) => get("specialTags").has(t)),
});
```

Refs also work with scope instances for nested reactive access:

```ts
const address = valueScope({
  street: value<string>(),
  city: value("NYC"),
  full: (get) => `${get("street")}, ${get("city")}`,
});
const sharedAddress = address.create({ street: "123 Main" });

const person = valueScope({
  name: value<string>(),
  address: valueRef(sharedAddress),
});
const bob = person.create({ name: "Bob" });

bob.get("address").get("full"); // '123 Main, NYC'
bob.get("address").set("street", "456 Oak"); // mutates the shared instance
```

Signal tracking flows transitively — derivations that read through a ref
automatically react to changes in the referenced scope.

## Keyed collections of scopes

When you need many instances of the same scope — rows in a table, items in a
list, entries in a form — use `.createMap()`:

```ts
// Empty collection
const people = person.createMap();

// From an array — string shorthand for the key field
const people = person.createMap(apiResponse, "id");

// From an array — callback for computed keys
const people = person.createMap(apiResponse, (item) => item.id);

// From a Map
const people = person.createMap(
  new Map([
    ["alice", { firstName: "Alice", lastName: "Smith" }],
    ["bob", { firstName: "Bob", lastName: "Jones" }],
  ]),
);
```

Add, update, and remove entries:

```ts
people.set("alice", { firstName: "Alice", lastName: "Smith" });
people.delete("alice"); // fires onDestroy for that instance
people.size; // number of entries
people.keys(); // string[]
people.has("alice"); // boolean
people.clear(); // remove all, fires onDestroy for each
```

In React, each row is its own reactive boundary:

```tsx
type People = ReturnType<typeof person.createMap>;

function PersonRow({ id, people }: { id: string; people: People }) {
  const [get, set] = people.use(id);

  return (
    <input
      value={get("firstName")}
      onChange={(e) => set("firstName", e.target.value)}
    />
  );
}

function PeopleTable({ people }: { people: People }) {
  const keys = people.useKeys();
  return keys.map((id) => <PersonRow key={id} id={id} people={people} />);
}
```

Per-field subscriptions work here too:

```ts
const [firstName, setFirstName] = people.use("bob", "firstName");
const [fullName] = people.use("bob", "fullName"); // derivation, read-only
```

## Lifecycle

Scopes support lifecycle hooks via a config object as the second argument.

### onInit

Runs once when an instance is created. Receives `{ set, get, input }` — the raw
value passed to `create()` or `map.set()`:

```ts
const formField = valueScope(
  {
    value: value<string>(),
    initialValue: value<string>(),
    isTouched: value<boolean>(),
    isDirty: (get) => get("value") !== get("initialValue"),
  },
  {
    onInit: ({ set, get }) => {
      set("initialValue", get("value"));
      set("isTouched", false);
    },
  },
);
```

### onChange

Fires after mutations. **Batched by default** — multiple synchronous sets
produce one `onChange` call on the next microtask. Sets inside `onChange` do not
re-trigger the hook:

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    lastUpdated: value<number>(0),
  },
  {
    onChange: ({ changes, set, get, getSnapshot }) => {
      // changes = [{ key: 'firstName', from: 'Bob', to: 'Robert' }]
      set("lastUpdated", Date.now());
    },
  },
);
```

### onUsed / onUnused

`onUsed` fires when the first subscriber starts watching. `onUnused` fires when
the last subscriber stops. Useful for lazy resources:

```ts
const stockPrice = valueScope(
  {
    symbol: value<string>(),
    price: value<number>(0),
    interval: value<number | null>(null),
  },
  {
    onUsed: ({ set, get }) => {
      const id = setInterval(async () => {
        const p = await fetchPrice(get("symbol"));
        set("price", p);
      }, 1000);
      set("interval", id);
    },
    onUnused: ({ get }) => {
      clearInterval(get("interval"));
    },
  },
);
```

### onDestroy

Runs when an instance is removed from a collection or manually destroyed:

```ts
const chatRoom = valueScope(
  {
    roomId: value<string>(),
    ws: value<WebSocket | null>(null),
  },
  {
    onInit: ({ set, get }) => {
      set("ws", new WebSocket(`/rooms/${get("roomId")}`));
    },
    onDestroy: ({ get }) => {
      get("ws")?.close();
    },
  },
);

const rooms = chatRoom.createMap();
rooms.delete("room-42"); // onDestroy fires, websocket closes
```

### allowUndeclaredProperties

By default, properties not declared in the scope are silently dropped. Set
`allowUndeclaredProperties: true` to preserve them as plain, non-reactive data:

```ts
const baseNode = valueScope(
  {
    id: value<string>(),
    type: value<string>(),
    isHighlighted: value<boolean>(false),
  },
  { allowUndeclaredProperties: true },
);

// Slate node has { id, type, text, children, bold, italic, ... }
const nodes = baseNode.createMap();
nodes.set("node-1", slateNode);
// id, type, isHighlighted — reactive
// text, children, bold, italic — preserved but not reactive
```

## Extending scopes

`.extend()` returns a new scope that includes everything from the original plus
new state, derivations, and lifecycle hooks. The original is untouched:

```ts
const trackedPerson = person.extend(
  {
    lastUpdated: value<number>(Date.now()),
    changeCount: value<number>(0),
  },
  {
    onChange: ({ changes, set }) => {
      set("lastUpdated", Date.now());
      set("changeCount", (prev) => prev + changes.length);
    },
  },
);
```

Extended scopes can promote passthrough properties into reactive values:

```ts
const paragraphNode = baseNode.extend({
  text: value<string>(""),
  wordCount: (get) => get("text").split(/\s+/).filter(Boolean).length,
});

const imageNode = baseNode.extend({
  src: value<string>(),
  alt: value<string>(""),
  isLoading: value<boolean>(false),
});
```

### Reusable middleware

Since `.extend()` takes a scope and returns a scope, middleware is just a
function:

```ts
const withTracking = (scope) =>
  scope.extend(
    {
      lastUpdated: value<number>(Date.now()),
      changeCount: value<number>(0),
    },
    {
      onChange: ({ changes, set }) => {
        set("lastUpdated", Date.now());
        set("changeCount", (prev) => prev + changes.length);
      },
    },
  );

const withSoftDelete = (scope) =>
  scope.extend({
    deleted: value<boolean>(false),
    deletedAt: value<number | null>(null),
  });

// Compose
const fullPerson = withSoftDelete(withTracking(person));
```

## Factories

Since a scope is just a function return value, you can parameterize them:

```ts
import { type } from "arktype";

const formField = (initialValue, schema) =>
  valueScope(
    {
      value: value(initialValue),
      initialValue: value(initialValue),
      isTouched: value<boolean>(),

      isDirty: (get) => get("value") !== get("initialValue"),
      isValid: (get) => schema.allows(get("value")),
      errors: (get) => schema(get("value")).errors ?? [],
      error: (get) =>
        get("isTouched") && !get("isValid") ? get("errors")[0]?.message : null,
    },
    {
      onInit: ({ set, get }) => {
        set("initialValue", get("value"));
        set("isTouched", false);
      },
    },
  );

const contactForm = valueScope({
  name: formField("", type("string > 0")),
  email: formField("", type("string.email")),
  age: formField(18, type("number.integer >= 18")),

  isValid: (get) =>
    get("name").isValid && get("email").isValid && get("age").isValid,
  firstError: (get) =>
    get("name").error ?? get("email").error ?? get("age").error,
});
```

## Batching

Use `batch()` to group multiple writes so subscribers fire once:

```ts
import { batch } from "valuse";

batch(() => {
  name.set("Bob");
  count.set(42);
});
// Subscribers notified once, not twice
```

## API reference

### Primitives

| Export                     | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `value<T>()`               | Reactive value, starts as `undefined`                     |
| `value<T>(default)`        | Reactive value with default                               |
| `valueRef(source)`         | Reference to external reactive state (shared, not copied) |
| `value().pipe(fn)`         | Transform values on set, chainable                        |
| `value().compareUsing(fn)` | Custom equality check for re-renders                      |
| `valueSet<T>()`            | Reactive Set (accepts `T[]` or `Set<T>`)                  |
| `valueMap<K, V>()`         | Reactive Map (accepts `[K, V][]` or `Map<K, V>`)          |
| `batch(fn)`                | Group writes — subscribers fire once                      |

### Scopes

| Method                          | Description                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `valueScope({ ... })`           | Define a scope template                                            |
| `valueScope({ ... }, config)`   | Define a scope with lifecycle hooks                                |
| `scope.create(data)`            | Create a single instance                                           |
| `scope.createMap()`             | Create an empty keyed collection of instances                      |
| `scope.createMap(data, getKey)` | Create a collection from an array, keyed by field name or callback |
| `scope.createMap(mapData)`      | Create a collection from a `Map<string, data>`                     |
| `scope.extend({ ... })`         | Derive a new scope with additional state and derivations           |

### Instance methods

| Method               | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `.get(key)`          | Read a single value, derivation, or ref                             |
| `.set(key, value)`   | Set a single value field (callback form: `prev => next`)            |
| `.set({ ... })`      | Bulk set — each provided key is set, others untouched               |
| `.getSnapshot()`     | Plain object of full state (values, derivations, refs, passthrough) |
| `.setSnapshot(data)` | Full replace — omitted value keys reset to `undefined`              |
| `.subscribe(fn)`     | Listen for changes, returns unsubscribe function                    |
| `.destroy()`         | Tear down instance, fire `onDestroy`, detach all subscribers        |

### Scope config

| Option                      | Description                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `onInit`                    | Once, when created. Receives `{ set, get, input }`                                    |
| `onChange`                  | After mutations, batched per microtask. Receives `{ changes, set, get, getSnapshot }` |
| `onUsed`                    | When the first subscriber starts watching                                             |
| `onUnused`                  | When the last subscriber stops watching                                               |
| `onDestroy`                 | When an instance is removed or destroyed                                              |
| `allowUndeclaredProperties` | Preserve unrecognized properties as plain non-reactive data (default: `false`)        |

### React hooks

Import from `valuse/react` to enable `.use()` hooks.

| Hook                       | Returns                                        |
| -------------------------- | ---------------------------------------------- |
| `value.use()`              | `[value, setValue]`                            |
| `valueSet.use()`           | `[Set<T>, setter]`                             |
| `valueMap.use()`           | `[Map<K,V>, setter]`                           |
| `valueMap.use(key)`        | `[value, setter]` for that key                 |
| `valueMap.useKeys()`       | Array of keys                                  |
| `instance.use()`           | `[get, set]` — all fields                      |
| `instance.use(field)`      | `[value, setter]` or `[value]` for derivations |
| `scopeMap.use(key)`        | `[get, set]` for that instance                 |
| `scopeMap.use(key, field)` | `[value, setter]` or `[value]` for derivations |
| `scopeMap.useKeys()`       | Array of keys                                  |
