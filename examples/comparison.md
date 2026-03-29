# Comparison: ValUse vs Zustand vs Jotai vs Context

> State libraries make you choose: one big store (Zustand) or scattered atoms
> (Jotai). ValUse gives you **scopes** — structured, reactive models with typed
> fields, derived state, and lifecycle hooks built in, so your state mirrors how
> your data actually works instead of how your framework wants it.

The same feature — a **user table** with editable rows, derived display names,
change tracking, and per-row React subscriptions — built four ways. The
multi-instance problem is where state libraries diverge most.

## The feature

- A table of users, each with `firstName`, `lastName`, `email`, and `role`
- `displayName` is derived per user: `"firstName lastName"`
- Changes are tracked per user: `lastUpdated` timestamp
- Editing one user's email must NOT re-render other rows
- Users can be added and removed dynamically

---

## ValUse

```ts
import { value, valueScope } from "valuse";

// A scope is a structured, reactive model; like a class, but declarative.
// value<T>() declares a reactive field. Pass a default, or leave empty (starts undefined).
const user = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    email: value<string>(),
    role: value<string>("viewer"), // default value
    lastUpdated: value<number>(0),

    // Plain functions are derived state, recomputed when dependencies change
    displayName: (get) => `${get("firstName")} ${get("lastName")}`,
  },
  {
    // Fires on any field change. get/set are typed to this scope's fields.
    onChange: (changes, set, get, getSnapshot) => {
      set("lastUpdated", Date.now());
    },
  },
);

// createMap() gives you a keyed collection of scope instances.
// Each entry is a fully independent reactive model.
const users = user.createMap();
```

```tsx
// valuse/react re-exports everything from valuse, plus React hooks
import { value, valueScope } from "valuse/react";

function UserTable() {
  // useKeys() subscribes to the key list only —
  // re-renders on add/remove, not on field changes
  const keys = users.useKeys();

  return (
    <table>
      <tbody>
        {keys.map((id) => (
          <UserRow key={id} id={id} />
        ))}
      </tbody>
    </table>
  );
}

function UserRow({ id }: { id: string }) {
  // use(id) subscribes to one scope instance.
  // get() reads fields, set() writes them, both fully typed.
  const [get, set] = users.use(id);

  return (
    <tr>
      {/* Derived fields are read the same way as value fields */}
      <td>{get("displayName")}</td>
      <td>
        <input value={get("email")} onChange={(e) => set("email", e.target.value)} />
      </td>
      <td>{get("role")}</td>
    </tr>
  );
}
```

Each user is a self-contained model with typed fields, derived state, and
change tracking. The collection manages add/remove/lookup. Per-row
subscriptions are automatic.

---

## React Context

Context is the "no library" approach. Read through and notice how much
scaffolding is needed just to avoid re-rendering every row on every keystroke.

```tsx
import { createContext, useContext, useReducer, useCallback, memo } from "react";

type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  lastUpdated: number;
};

type State = Record<string, User>;
type Action =
  | { type: "SET_FIELD"; id: string; field: keyof User; value: string }
  | { type: "ADD"; id: string; user: User }
  | { type: "REMOVE"; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_FIELD":
      return {
        ...state,
        [action.id]: {
          ...state[action.id],
          [action.field]: action.value,
          lastUpdated: Date.now(),
        },
      };
    case "ADD":
      return { ...state, [action.id]: action.user };
    case "REMOVE": {
      const { [action.id]: _, ...rest } = state;
      return rest;
    }
  }
}

const UsersContext = createContext<State>({});
const DispatchContext = createContext<React.Dispatch<Action>>(() => {});

function UserTable() {
  const [state, dispatch] = useReducer(reducer, {});
  const keys = Object.keys(state);

  return (
    // Two providers needed to separate state reads from dispatch
    <UsersContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <table>
          <tbody>
            {keys.map((id) => (
              <UserRow key={id} id={id} />
            ))}
          </tbody>
        </table>
      </DispatchContext.Provider>
    </UsersContext.Provider>
  );
}

// Without memo + split contexts, every row re-renders on every keystroke.
// Even WITH memo, you need a stable dispatch ref and careful selector logic.
const UserRow = memo(function UserRow({ id }: { id: string }) {
  const users = useContext(UsersContext);
  const dispatch = useContext(DispatchContext);
  const user = users[id];

  // No derived fields, compute inline
  const displayName = `${user.firstName} ${user.lastName}`;

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <input
          value={user.email}
          onChange={(e) =>
            dispatch({
              type: "SET_FIELD",
              id,
              field: "email",
              value: e.target.value,
            })
          }
        />
      </td>
      <td>{user.role}</td>
    </tr>
  );
});
```

Even with two contexts and `memo`, editing one row still passes
the entire state object through context; React diffs the memo props to skip
re-renders, but the context value changes on every keystroke. There are no
derived fields, no lifecycle hooks, no type-safe field setters. The reducer
is boilerplate that grows linearly with the number of actions. And none of this
state logic is usable outside React.

---

## Zustand

Notice that per-row isolation requires manual selectors, and the store has to
define a setter for every mutation. Derived state like `displayName` either
lives in the component or requires a custom selector.

```ts
import { create } from "zustand";

type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  lastUpdated: number;
};

interface UserStore {
  users: Record<string, User>;
  addUser: (id: string, user: User) => void;
  removeUser: (id: string) => void;
  setField: (id: string, field: keyof User, value: string) => void;
}

const useUserStore = create<UserStore>((set) => ({
  users: {},
  addUser: (id, user) => set((s) => ({ users: { ...s.users, [id]: user } })),
  removeUser: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.users;
      return { users: rest };
    }),
  // Every mutation spreads the entire users map + the individual user
  setField: (id, field, value) =>
    set((s) => ({
      users: {
        ...s.users,
        [id]: { ...s.users[id], [field]: value, lastUpdated: Date.now() },
      },
    })),
}));
```

```tsx
function UserTable() {
  const ids = useUserStore((s) => Object.keys(s.users));
  return (
    <table>
      <tbody>
        {ids.map((id) => (
          <UserRow key={id} id={id} />
        ))}
      </tbody>
    </table>
  );
}

function UserRow({ id }: { id: string }) {
  // Must write a selector per field to avoid re-rendering on unrelated changes.
  // Without the selector, editing alice re-renders bob.
  const email = useUserStore((s) => s.users[id]?.email ?? "");
  const firstName = useUserStore((s) => s.users[id]?.firstName ?? "");
  const lastName = useUserStore((s) => s.users[id]?.lastName ?? "");
  const role = useUserStore((s) => s.users[id]?.role ?? "");
  const setField = useUserStore((s) => s.setField);

  const displayName = `${firstName} ${lastName}`;

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <input value={email} onChange={(e) => setField(id, "email", e.target.value)} />
      </td>
      <td>{role}</td>
    </tr>
  );
}
```

Every mutation spreads the entire `users` map.
Per-field selectors are required; skip one and unrelated edits re-render the
row. Derived state (`displayName`) is computed in the component, not the model.
Change tracking (`lastUpdated`) is manually duplicated wherever you write a
setter. Adding a new action means touching the store interface, the
implementation, and every component that calls it.

---

## Jotai

Notice that each user is a separate atom family entry, and keeping the key list
in sync requires a second atom plus manual coordination on add/remove.

```ts
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  lastUpdated: number;
};

// One atom per user
const userAtom = atomFamily((id: string) =>
  atom<User>({
    firstName: "",
    lastName: "",
    email: "",
    role: "viewer",
    lastUpdated: 0,
  }),
);

// Separate atom for the key list, must be kept in sync manually
const userIdsAtom = atom<string[]>([]);

// Writable atom for field updates with change tracking
const setUserField = atom(
  null,
  (
    get,
    set,
    {
      id,
      field,
      value,
    }: {
      id: string;
      field: keyof User;
      value: string;
    },
  ) => {
    const user = get(userAtom(id));
    set(userAtom(id), { ...user, [field]: value, lastUpdated: Date.now() });
  },
);

// Add/remove must update both the family entry and the key list
const addUser = atom(
  null,
  (
    get,
    set,
    {
      id,
      user,
    }: {
      id: string;
      user: User;
    },
  ) => {
    set(userAtom(id), user);
    set(userIdsAtom, [...get(userIdsAtom), id]);
  },
);

const removeUser = atom(null, (get, set, id: string) => {
  set(
    userIdsAtom,
    get(userIdsAtom).filter((k) => k !== id),
  );
  // Note: the atomFamily entry is NOT cleaned up; it leaks unless you call .remove(id)
});
```

```tsx
import { useAtom, useAtomValue, useSetAtom } from "jotai";

function UserTable() {
  const ids = useAtomValue(userIdsAtom);
  return (
    <table>
      <tbody>
        {ids.map((id) => (
          <UserRow key={id} id={id} />
        ))}
      </tbody>
    </table>
  );
}

function UserRow({ id }: { id: string }) {
  const [user, setUser] = useAtom(userAtom(id));
  const updateField = useSetAtom(setUserField);

  const displayName = `${user.firstName} ${user.lastName}`;

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <input
          value={user.email}
          onChange={(e) =>
            updateField({
              id,
              field: "email",
              value: e.target.value,
            })
          }
        />
      </td>
      <td>{user.role}</td>
    </tr>
  );
}
```

Each user is its own atom (good for isolation),
but the key list is a separate atom that must be manually synchronized on every
add/remove; forget and the UI desyncs. `atomFamily` entries leak unless you
explicitly call `.remove(id)`. Derived state is computed in the component.
Change tracking requires a writable atom wrapper around every mutation.
`Provider` is required for isolation across component trees.

---

## Side-by-side summary

| Concern             | ValUse                                | Context                               | Zustand                                     | Jotai                             |
| ------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------- | --------------------------------- |
| Define a user model | `valueScope({ ... })`                 | Type alias + reducer                  | Interface + store factory                   | `atomFamily` per entity           |
| Collection of users | `user.createMap()`                    | `Record<string, User>` in state       | Map-in-store + spreads                      | `atomFamily` + separate key atom  |
| Add/remove users    | `users.set(id, data)` / `.delete(id)` | Dispatch action                       | Store action                                | Update family + key atom          |
| Derived state       | Inline `(get) => ...` in scope        | Compute in component                  | Compute in component or write selector      | `atom((get) => ...)` or component |
| Change tracking     | `onChange` hook, one place            | Manual in reducer                     | Manual in every setter                      | Manual in writable atoms          |
| Per-row isolation   | Automatic                             | Requires `memo` + split contexts      | Requires per-field selectors                | One atom per entity (leaks)       |
| Lifecycle hooks     | `onUsed` / `onUnused` / `onDestroy`   | `useEffect` in component              | `useEffect` in component                    | `useEffect` in component          |
| Works outside React | `.get()` / `.set()` / `.subscribe()`  | No                                    | `getState()` / `setState()` / `subscribe()` | Requires `Store` instance         |
| Type safety on set  | `set("email", value)`, key is typed   | `dispatch({ field: "email" })`, loose | `setField(id, "email", value)`, loose       | `set(atom, value)`, per atom      |

The core difference: **ValUse treats "a user" as a structured, reactive model —
then gives you a typed collection of them.** The others require you to build
that structure yourself out of primitives (atoms, store slices, reducer cases),
and the scaffolding grows with every field and every action.
