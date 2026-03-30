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

## Values

The building block. A `value` is a single piece of reactive state.

```ts
import { value } from "valuse";

const name = value<string>("Alice");
const count = value<number>(0);
```

In React:

```tsx
const [name, setName] = name.use();
// name = 'Alice'
// setName('Bob') — updates and re-renders
```

### Custom comparison

By default, values re-render on identity change. Override with
`.compareUsing()`:

```ts
const user = value<User>({ id: 1, name: "Alice" }).compareUsing(
  (a, b) => a.id === b.id,
);
```

### Transforms

Chain `.pipe()` to normalize values on every `set`. Transforms run in order
before the value is stored:

```ts
const email = value<string>("")
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase())
  .compareUsing((a, b) => a === b);
```

Since pipes are just functions, extract and reuse them:

```ts
const trim = (v: string) => v.trim();
const lower = (v: string) => v.toLowerCase();
const clamp = (min: number, max: number) => (v: number) =>
  Math.max(min, Math.min(max, v));

const email = value<string>("").pipe(trim).pipe(lower);
const age = value<number>(0).pipe(clamp(0, 150));
const name = value<string>("").pipe(trim);
```

## Collections

Reactive versions of the JS data structures you already know.

### valueSet

```ts
import { valueSet } from "valuse";

const tags = valueSet<string>(["admin", "active"]);
// Also accepts: valueSet(new Set(["admin", "active"]))

const [current, set] = tags.use();
current; // Set { 'admin', 'active' }
set((t) => t.add("editor"));
set((t) => t.delete("admin"));
```

### valueMap

```ts
import { valueMap } from "valuse";

const scores = valueMap<string, number>();
// Also accepts: valueMap(new Map([["alice", 95]]))
// Or entries:   valueMap([["alice", 95], ["bob", 82]])

const [current, set] = scores.use();
set((s) => s.set("alice", 95));
set((s) => s.set("bob", 82));
set((s) => s.delete("bob"));
```

Per-key reactivity:

```ts
const [aliceScore, setAliceScore] = scores.use("alice"); // only re-renders when alice's score changes
const keys = scores.useKeys(); // only re-renders when keys change
```

## Scopes

A `valueScope` is a template that bundles related state and derivations
together.

```ts
import { value, valueScope } from "valuse";

const address = valueScope({
  street: value<string>(),
  city: value<string>(),
  state: value<string>(),
  full: (get) => `${get("street")}, ${get("city")}, ${get("state")}`,
});
```

Values called without an argument start as `undefined`. Values called with an
argument start with that default:

```ts
const person = valueScope({
  firstName: value<string>(), // starts as undefined
  lastName: value<string>(), // starts as undefined
  role: value<string>("viewer"), // starts as 'viewer'

  fullName: (get) => `${get("firstName")} ${get("lastName")}`,
});
```

### Creating instances

```ts
// Provide everything
const bob = person.create({
  firstName: "Bob",
  lastName: "Jones",
  // role defaults to 'viewer'
});

// Provide some — firstName and lastName start as undefined
const partial = person.create({ role: "admin" });

// Provide nothing — everything is undefined or defaults
const empty = person.create();

const [get, set] = bob.use();
get("fullName"); // 'Bob Jones'
set("role", "admin");
```

### Getting values

`get` reads the current value outside of React. In React, `use` subscribes and
re-renders on change.

Value:

```ts
name.get(); // "Alice" — plain read, no subscription
const [currentName, setName] = name.use(); // React subscription
```

ValueSet:

```ts
tags.get(); // Set { "a", "b" }
const [currentTags, setTags] = tags.use();
```

ValueMap:

```ts
scores.get(); // Map { "alice" => 90 }
const [currentScores, setScores] = scores.use();
```

Scope instance:

```ts
bob.get("firstName"); // "Bob" — plain read of one field
bob.get("fullName"); // "Bob Jones" — derivations work too

const [get, set] = bob.use(); // React subscription to all fields
get("firstName"); // "Bob"

const [firstName, setFirstName] = bob.use("firstName"); // subscribe to one field
const [fullName] = bob.use("fullName"); // derived — no setter
```

### Setting values

`set` works consistently across all types:

Value:

```ts
const [currentName, setName] = name.use();
setName("Bob");
```

ValueSet:

```ts
const [currentTags, setTags] = tags.use();
setTags(new Set(["a", "b"])); // replace the whole set
setTags((t) => t.add("c")); // mutate callback
```

ValueMap:

```ts
const [currentScores, setScores] = scores.use();
setScores((s) => s.set("alice", 95));
```

Scope instance:

```ts
const [get, set] = bob.use();
set("firstName", "Robert");
set("count", (prev) => prev + 1); // callback form
set({ firstName: "Robert", lastName: "Smith", role: "admin" }); // bulk
```

Bulk `set` sets each provided value key. Derivation, ref, and unrecognized keys
are silently ignored. It does not replace the entire state — omitted fields keep
their current values.

### Snapshots

`getSnapshot()` returns a plain object of the full scope state — all values,
derivations, refs, and passthrough data:

```ts
const bob = person.create({ firstName: "Bob", lastName: "Jones" });
bob.getSnapshot();
// { firstName: 'Bob', lastName: 'Jones', role: 'viewer', fullName: 'Bob Jones' }
```

This is a one-time read, not reactive. Useful for serialization, debugging, or
passing to non-reactive code.

`setSnapshot()` is the inverse — "make the data structure exactly this". Omitted
keys reset to `undefined`, not left as-is. It's a full replacement, not a merge:

```ts
bob.setSnapshot({ firstName: "Alice", lastName: "Smith", role: "admin" });
bob.get("firstName"); // "Alice"

bob.setSnapshot({ firstName: "Charlie" });
bob.get("firstName"); // "Charlie"
bob.get("lastName"); // undefined — not "Smith"
bob.get("role"); // undefined — not "admin"
```

Use `setSnapshot(data, { rerunInit: true })` to re-fire the `onInit` hook after
restoring.

### Referencing external state

Use `valueRef()` to bring external reactive state into a scope. Refs are shared
across all instances — they point to the same source, not a copy:

```ts
import { value, valueRef, valueScope, valueSet } from "valuse";

const globalSpecialTags = valueSet<string>(["admin", "root"]);

const person = valueScope({
  firstName: value<string>(),
  tags: valueSet<string>(),
  specialTags: valueRef(globalSpecialTags), // shared, not copied

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
list, entries in a form — use `.createMap()` on a scope:

```ts
const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  role: value<string>("viewer"),
  fullName: (get) => `${get("firstName")} ${get("lastName")}`,
});

// Empty collection
const people = person.createMap();

// Initialize from an array — string shorthand for the key field
const people = person.createMap(apiResponse, "id");

// Initialize from an array — callback for computed keys
const people = person.createMap(apiResponse, (item) => item.id);

// Initialize from a Map
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
people.set("bob", { firstName: "Bob", lastName: "Jones", role: "admin" });
people.delete("alice");
```

In React, each row is its own reactive boundary. Pass the collection as a prop,
or provide it through context — your call:

```tsx
type People = ReturnType<typeof person.createMap>;

const PersonRow = ({ id, people }: { id: string; people: People }) => {
  const [get, set] = people.use(id);
  // Only re-renders when this person's data changes

  return (
    <input
      value={get("firstName")}
      onChange={(e) => set("firstName", e.target.value)}
    />
  );
};

const PeopleTable = ({ people }: { people: People }) => {
  const keys = people.useKeys();
  return keys.map((id) => <PersonRow key={id} id={id} people={people} />);
};
```

Subscribe to a single field for finer granularity — only re-renders when that
specific field changes, not on any change to the instance:

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
    onInit: ({ set, get, input }) => {
      set("initialValue", get("value"));
      set("isTouched", false);
    },
  },
);
```

### onChange

Fires after any mutation to owned state. **Batched by default** — if multiple
values are set synchronously, you get one `onChange` call with all changes on
the next microtask. Sets inside `onChange` do not re-trigger the hook.

```ts
const person = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    lastUpdated: value<number>(0),
    changeCount: value<number>(0),
  },
  {
    onChange: ({ changes, set, get, getSnapshot }) => {
      // changes = [{ key: 'firstName', from: 'Bob', to: 'Robert' },
      //            { key: 'lastName', from: 'Jones', to: 'Smith' }]
      set("lastUpdated", Date.now());
      set("changeCount", (prev) => prev + changes.length);
    },
  },
);
```

### onUsed / onUnused

`onUsed` fires when the first subscriber starts watching the scope. `onUnused`
fires when the last subscriber stops. Useful for lazy resources — don't poll
unless someone's looking:

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

Runs when an instance is removed from a `.createMap()` collection, or when
manually destroyed. Use for cleanup:

```ts
const chatRoom = valueScope(
  {
    roomId: value<string>(),
    ws: value<WebSocket | null>(null),
  },
  {
    onInit: ({ set, get, input }) => {
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

By default, properties not declared in the scope are silently ignored on
`create()` and `set()`. Set `allowUndeclaredProperties: true` to preserve them
as plain, non-reactive data. Useful when your scope manages a subset of a larger
object — like a Slate editor node:

```ts
const baseNode = valueScope(
  {
    id: value<string>(),
    type: value<string>(),
    isHighlighted: value<boolean>(false),
  },
  {
    allowUndeclaredProperties: true,
  },
);

const nodes = baseNode.createMap();

// Slate node has { id, type, text, children, bold, italic, ... }
nodes.set("node-1", slateNode);

// id, type, isHighlighted — reactive, managed by the scope
// text, children, bold, italic — preserved, accessible, but not reactive
```

Extended scopes can then promote passthrough properties into reactive values:

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

## Extending scopes

`.extend()` returns a new scope that includes everything from the original plus
new state and derivations. The original scope is untouched.

```ts
const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  fullName: (get) => `${get("firstName")} ${get("lastName")}`,
});

const trackedPerson = person.extend(
  {
    lastUpdated: value<number>(Date.now()),
    changeCount: value<number>(0),
  },
  {
    onChange: ({ changes, set, get, getSnapshot }) => {
      set("lastUpdated", Date.now());
      set("changeCount", (prev) => prev + changes.length);
    },
  },
);
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
      onChange: ({ changes, set, get, getSnapshot }) => {
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
const people = fullPerson.createMap();
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
      onInit: ({ set, get, input }) => {
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

const form = contactForm.create({
  name: { value: "Alice" },
  email: { value: "alice@foo.com" },
  age: { value: 25 },
});
```

## Implementation notes

### Reactive primitive

ValUse is built on signals. Under the hood, `value()` creates a signal,
derivations create computed signals, and `.use()` bridges into React via
`useSyncExternalStore`. This means ValUse works with any framework — React hooks
are a convenience layer, not a requirement.

### Non-React usage

Every reactive thing exposes `.get()`, `.set()`, and `.subscribe()` for use
outside React:

```ts
// value
const name = value<string>("Alice");
name.get(); // 'Alice'
name.set("Bob");
name.subscribe((v) => console.log(v)); // logs on every change

// scope instance
const bob = person.create({ firstName: "Bob", lastName: "Jones" });
bob.get("fullName"); // 'Bob Jones'
bob.set("firstName", "Robert");
bob.set({ firstName: "Robert", lastName: "Smith" }); // bulk set
bob.getSnapshot(); // { firstName: 'Robert', lastName: 'Smith', role: 'viewer', fullName: 'Robert Smith' }
bob.subscribe((get) => {
  console.log(get("fullName"));
});

// scope map — whole collection
const people = person.createMap();
people.subscribe((keys) => {
  console.log("keys changed:", keys);
});
```

All `.subscribe()` calls return an unsubscribe function:

```ts
const unsub = name.subscribe((v) => console.log(v));
unsub(); // stop listening
```

### Destroying instances

Standalone scope instances can be destroyed manually. This fires `onDestroy` and
cleans up all subscriptions:

```ts
const bob = person.create({ firstName: "Bob" });
bob.destroy(); // onDestroy fires, all subscribers detached
```

For map collections, `.delete()` destroys the instance:

```ts
people.delete("bob"); // onDestroy fires for bob's scope
```

### Settability rules

Only `value()`, `valueSet()`, and `valueMap()` fields are settable. Derivations
and refs are read-only. Attempting to `set` a derivation or ref is a TypeScript
error. At runtime, derivations, refs, and unrecognized keys are silently ignored
— no errors thrown. To preserve unrecognized keys as non-reactive data, use
`allowUndeclaredProperties: true` in the scope config.

### Callback setters

The `set` function accepts a callback that receives the previous value. Use this
for updates that depend on current state:

```ts
set("count", (prev) => prev + 1);
set("tags", (prev) => new Set([...prev, "new-tag"]));
```

This works everywhere — standalone values, scope fields, and inside lifecycle
hooks.

### Mutation callbacks for collections

`valueSet` and `valueMap` mutation callbacks receive an Immer-style draft. You
write mutations, the library produces a new immutable value:

```ts
const tags = valueSet<string>(["admin"]);

// The callback receives a draft — mutations are recorded, not applied directly
tags.set((draft) => draft.add("editor"));
// Under the hood: new Set with 'editor' added
```

This also applies to `valueSet` and `valueMap` fields inside scopes.

### Async derivations

Derivations can be async. An async derivation returns a `Promise` that resolves
to the derived value:

```ts
const person = valueScope({
  userId: value<string>(),
  profile: async (get) => {
    const res = await fetch(`/api/users/${get("userId")}`);
    return res.json();
  },
});
```

Async derivations start as `undefined` while loading. When the promise resolves,
subscribers are notified. If a dependency changes while a previous promise is in
flight, the stale result is discarded.

### Pipes and comparison on collections

`.pipe()` and `.compareUsing()` work on `valueSet` and `valueMap` too:

```ts
const tags = valueSet<string>()
  .pipe((s) => new Set([...s].map((t) => t.toLowerCase())))
  .compareUsing((a, b) => a.size === b.size);
```

### Map collection methods

`scope.createMap()` and `valueMap()` expose standard Map-like methods:

```ts
const people = person.createMap();

people.size; // number of entries
people.has("alice"); // boolean
people.keys(); // string[]
people.values(); // array of scope instances
people.entries(); // [key, instance][]
people.clear(); // remove all (fires onDestroy for each)
```

## API summary

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

### Scope instance methods

| Method               | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `.get(key)`          | Read a single value, derivation, or ref                             |
| `.set(key, value)`   | Set a single value field                                            |
| `.set({ ... })`      | Merge — sets each provided key, leaves others untouched             |
| `.getSnapshot()`     | Plain object of full state (values, derivations, refs, passthrough) |
| `.setSnapshot(data)` | Full replace — omitted value keys reset to `undefined`              |
| `.subscribe(fn)`     | Listen for changes, returns unsubscribe function                    |
| `.destroy()`         | Tear down instance, fire `onDestroy`, detach all subscribers        |

### Scope config

| Option                      | Description                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `onInit`                    | Once, when an instance is created. Receives `{ set, get, input }`                         |
| `onChange`                  | After mutations, batched per microtask. Receives `{ changes, set, get, getSnapshot }`     |
| `onUsed`                    | When the first subscriber starts watching                                                 |
| `onUnused`                  | When the last subscriber stops watching                                                   |
| `onDestroy`                 | When an instance is removed or destroyed                                                  |
| `allowUndeclaredProperties` | If `true`, preserve unrecognized properties as plain non-reactive data (default: `false`) |

### React hooks

Import from `valuse/react` to enable `.use()` hooks.

| Hook                       | Returns                                        |
| -------------------------- | ---------------------------------------------- |
| `value.use()`              | `[value, setValue]`                            |
| `valueSet.use()`           | `[Set<T>, setter]`                             |
| `valueMap.use()`           | `[Map<K,V>, setter]`                           |
| `valueMap.use(key)`        | `[value, setter]` for that key                 |
| `valueMap.useKeys()`       | Array of keys                                  |
| `instance.use()`           | `[get, set]` — all fields, coarse subscription |
| `instance.use(field)`      | `[value, setter]` or `[value]` for derivations |
| `scopeMap.use(key)`        | `[get, set]` for that instance                 |
| `scopeMap.use(key, field)` | `[value, setter]` or `[value]` for derivations |
| `scopeMap.useKeys()`       | Array of keys                                  |

### Core methods (framework-agnostic)

| Method           | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `.get()`         | Read current value (value, set, map) or `.get(key)` (scope)  |
| `.set()`         | Write value, accepts direct value or `prev => next` callback |
| `.subscribe(fn)` | Listen for changes, returns unsubscribe function             |
| `.destroy()`     | Tear down instance, fire `onDestroy`, detach all subscribers |
