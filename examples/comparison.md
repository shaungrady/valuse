# Comparison: ValUse vs Context vs Zustand vs Jotai

> State libraries make you choose: one big store (Zustand) or scattered atoms
> (Jotai). ValUse gives you **scopes** — structured, reactive models with typed
> fields, derived state, and lifecycle hooks built in, so your state mirrors how
> your data actually works instead of how your framework wants it.

This page compares ValUse to React Context, Zustand, and Jotai across three
dimensions: how many concepts you need to learn, how common concerns map to each
library, and what real code looks like when you build the same feature in all
four.

## Table of contents

- [Concept count](#concept-count)
- [Side-by-side summary](#side-by-side-summary)
- [Code comparison](#code-comparison) — user table built four ways

---

## Concept count

How many things do you need to learn before you can be productive?

**ValUse:** `value`, `valueScope`, `.use()`. That's it. Derivations are plain
functions. Collections are `.createMap()`. Lifecycle is an options object.
Everything composes the same way — scopes of scopes, collections of scopes, refs
between scopes. One mental model, applied recursively.

**Zustand:** stores, selectors, `set`/`get` inside stores, shallow comparison,
middleware (`persist`, `immer`, `devtools`), slices pattern for splitting
stores,`useStore` with selector functions, `getState`/`setState` for outside
React. Each pattern has its own conventions.

**Jotai:** atoms, derived atoms, writable atoms, `atomFamily`,
`atomWithStorage`,`selectAtom`, `splitAtom`, `focusAtom`, `Provider`/`Store` for
isolation, `useAtom`/`useAtomValue`/`useSetAtom`. The number of atom utilities
grows with every problem you solve, and combining them requires understanding
how Jotai's dependency graph resolves.

The real cost isn't learning these once — it's re-learning them three months
later when you come back to code that uses `splitAtom` inside an `atomFamily`
with a custom `selectAtom` comparator, and you have to reconstruct what that
combination was supposed to do.

---

## Side-by-side summary

| Concern               | ValUse                                                     | React Context                         | Zustand                                     | Jotai                                      |
| --------------------- | ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| Define a user model   | `valueScope({ ... })`                                      | Type alias + reducer                  | Interface + store factory                   | `atomFamily` per entity                    |
| Collection of users   | `user.createMap()`                                         | `Record<string, User>` in state       | Map-in-store + spreads                      | `atomFamily` + separate key atom           |
| Add/remove users      | `users.set(id, data)` / `.delete(id)`                      | Dispatch action                       | Store action                                | Update family + key atom                   |
| Derived state         | Inline `({ use }) => ...` in scope                         | Compute in component                  | Compute in component or write selector      | `atom((get) => ...)` or component          |
| Change tracking       | `onChange` hook, one place                                 | Manual in reducer                     | Manual in every setter                      | Manual in writable atoms                   |
| Per-row isolation     | Automatic                                                  | Requires `memo` + split contexts      | Requires per-field selectors                | One atom per entity (leaks)                |
| Lifecycle hooks       | `onUsed` / `onUnused` / `onDestroy`                        | `useEffect` in component              | `useEffect` in component                    | `useEffect` in component                   |
| Works outside React   | `.get()` / `.set()` / `.subscribe()`                       | No                                    | `getState()` / `setState()` / `subscribe()` | Requires `Store` instance                  |
| Type safety on set    | `set("email", value)`, key is typed                        | `dispatch({ field: "email" })`, loose | `setField(id, "email", value)`, loose       | `set(atom, value)`, per atom               |
| Multi-instance        | `createMap()`, call anywhere                               | Tied to component tree                | Singleton store                             | Requires `Provider`/`Store`                |
| Async data            | `async ({ use, signal }) => ...`                           | `useEffect` + `useState` × 3          | Async action + manual loading/error state   | `async atom` + `loadable()` wrapper        |
| Abort on dep change   | Automatic via `signal`                                     | Manual `AbortController` in effect    | Manual, often forgotten                     | No built-in abort                          |
| Loading/error state   | `getAsync()` / `useAsync()` built in                       | Manual `isLoading`/`error` state      | Manual fields in store                      | `loadable()` or Suspense boundary          |
| Async → sync boundary | Transparent — `use("asyncField")` returns `T \| undefined` | Consumer must handle Promise/loading  | Consumer must read loading/error fields     | Consumer must use `loadable()` or Suspense |

The core difference: **ValUse treats "a user" as a structured, reactive model —
then gives you a typed collection of them.** The others require you to build
that structure yourself out of primitives (atoms, store slices, reducer cases),
and the scaffolding grows with every field and every action.

---

## Code comparison

The same feature, a **user table** with editable rows, derived display names,
change tracking, per-row React subscriptions, **async profile fetch**, and
**sync derivations that chain off async data**, built four ways.

- A table of users, each with `firstName`, `lastName`, `email`, and `role`
- `displayName` is derived per user: `"firstName lastName"`
- Changes are tracked per user: `lastUpdated` timestamp
- Each user's `profile` is **fetched asynchronously** by userId, with abort on
  re-fetch
- `avatarUrl` is a **sync derivation** that reads the async `profile` — no
  promises, no loading checks
- Editing one user's email must NOT re-render other rows
- Users can be added and removed dynamically

---

### ValUse

```ts
import { value, valueScope } from 'valuse';

const user = valueScope(
  {
    firstName: value<string>(),
    lastName: value<string>(),
    email: value<string>(),
    role: value<string>('viewer'),
    lastUpdated: value<number>(0),

    displayName: ({ use }) => `${use('firstName')} ${use('lastName')}`,

    // Async derivation — fetches profile, aborts automatically on dep change.
    profile: async ({ use, signal }) => {
      const res = await fetch(`/api/users/${use('email')}`, { signal });
      return res.json();
    },

    // Sync derivation — reads async profile without knowing or caring it's async.
    // Sees Profile | undefined. Recomputes when profile resolves.
    avatarUrl: ({ use }) => {
      const profile = use('profile');
      return profile?.avatar ?? '/default-avatar.png';
    },
  },
  {
    onChange: ({ changes, set }) => {
      set('lastUpdated', Date.now());
    },
  },
);
```

```tsx
function UserTable() {
  const users = useMemo(() => user.createMap(), []);
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
  const [getUser, setUser] = users.use(id);

  return (
    <tr>
      <td>{getUser('displayName')}</td>
      <td>
        <img src={getUser('avatarUrl')} />
      </td>
      <td>
        <input
          value={getUser('email')}
          onChange={(e) => setUser('email', e.target.value)}
        />
      </td>
      <td>{getUser('role')}</td>
    </tr>
  );
}
```

Each user is a self-contained model with typed fields, derived state, change
tracking, and async data. The collection manages add/remove/lookup. Per-row
subscriptions are automatic. And because `user` is a template, you can call
`user.createMap()` again anywhere — multiple independent tables, a test harness,
a server route — without rewiring providers or creating new store definitions.

**No async contagion.** Notice that `avatarUrl` is a plain sync derivation. It
reads `profile` via `use()` and sees `Profile | undefined` — never a promise,
never a loading state. It recomputes when `profile` resolves, but it doesn't
know or care that `profile` is async. If you later change `profile` from an
async fetch to a sync computation (or vice versa), `avatarUrl` doesn't change at
all. In every other library below, async boundaries spread through the
dependency chain or force every consumer to check loading state.

If a component _does_ need loading/error details, it opts in with `useAsync()`:

```tsx
function ProfileCard({ id }: { id: string }) {
  const [profile, state] = users.useAsync(id, 'profile');

  if (state.status === 'setting') return <Spinner />;
  if (state.status === 'error') return <Error error={state.error} />;
  return <div>{profile.name}</div>;
}
```

**"But there are strings everywhere?"** — They're fully type-checked.
`get("emal")` is a TypeScript error. `set("displayName", ...)` is a type error
(it's derived). Autocomplete works on every key. The return type of
`get("role")` is `string`, `get("displayName")` is `string` — all inferred from
the scope definition. String keys are what let ValUse avoid the tangle of
references, atom imports, and selector functions that the alternatives require.
They also sidestep the naming problem: no `userStore`, `userAtom`,
`emailSignal`, `setEmail`. You just have `user` and call `get("email")` on it.

---

### React Context

Context is the "no library" approach. Read through and notice how much
scaffolding is needed just to avoid re-rendering every row on every keystroke —
and how much more async adds.

```tsx
import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  memo,
} from 'react';

type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  lastUpdated: number;
};

type ProfileState = {
  data: unknown | null;
  isLoading: boolean;
  error: unknown | null;
};

type State = {
  users: Record<string, User>;
  profiles: Record<string, ProfileState>;
};

type Action =
  | { type: 'SET_FIELD'; id: string; field: keyof User; value: string }
  | { type: 'ADD'; id: string; user: User }
  | { type: 'REMOVE'; id: string }
  | { type: 'SET_PROFILE'; id: string; profile: ProfileState };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_FIELD':
      return {
        ...state,
        users: {
          ...state.users,
          [action.id]: {
            ...state.users[action.id],
            [action.field]: action.value,
            lastUpdated: Date.now(),
          },
        },
      };
    case 'ADD':
      return {
        ...state,
        users: { ...state.users, [action.id]: action.user },
        profiles: {
          ...state.profiles,
          [action.id]: { data: null, isLoading: true, error: null },
        },
      };
    case 'REMOVE': {
      const { [action.id]: _, ...restUsers } = state.users;
      const { [action.id]: __, ...restProfiles } = state.profiles;
      return { users: restUsers, profiles: restProfiles };
    }
    case 'SET_PROFILE':
      return {
        ...state,
        profiles: { ...state.profiles, [action.id]: action.profile },
      };
  }
}

const UsersContext = createContext<State>({ users: {}, profiles: {} });
const DispatchContext = createContext<React.Dispatch<Action>>(() => {});

function UserTable() {
  const [state, dispatch] = useReducer(reducer, { users: {}, profiles: {} });
  const keys = Object.keys(state.users);

  return (
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

const UserRow = memo(function UserRow({ id }: { id: string }) {
  const { users, profiles } = useContext(UsersContext);
  const dispatch = useContext(DispatchContext);
  const user = users[id];
  const profile = profiles[id];

  // Async fetch — manual AbortController, manual state management
  useEffect(() => {
    const controller = new AbortController();
    dispatch({
      type: 'SET_PROFILE',
      id,
      profile: { data: null, isLoading: true, error: null },
    });

    fetch(`/api/users/${user.email}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) =>
        dispatch({
          type: 'SET_PROFILE',
          id,
          profile: { data, isLoading: false, error: null },
        }),
      )
      .catch((err) => {
        if (err.name !== 'AbortError') {
          dispatch({
            type: 'SET_PROFILE',
            id,
            profile: { data: null, isLoading: false, error: err },
          });
        }
      });

    return () => controller.abort();
  }, [user.email]);

  const displayName = `${user.firstName} ${user.lastName}`;

  // Sync derivation reading async? You just do it inline, with manual checks.
  const avatarUrl = profile?.data
    ? (profile.data as any).avatar
    : '/default-avatar.png';

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <img src={avatarUrl} />
      </td>
      <td>
        <input
          value={user.email}
          onChange={(e) =>
            dispatch({
              type: 'SET_FIELD',
              id,
              field: 'email',
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

Two contexts, `memo`, a reducer that grows linearly with actions, manual
`AbortController` + `useEffect` cleanup per async source, separate `profiles`
state tracked alongside `users`, inline `greeting` computation with manual null
checks. None of the state logic is reusable outside React, and editing one row
still passes the entire state object through context.

---

### Zustand

Per-row isolation requires manual selectors, and async adds `isLoading`,
`error`, and `controller` fields to the store. Derived state and
sync-reads-async both live in the component.

```ts
import { create } from 'zustand';

type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  lastUpdated: number;
};

type ProfileState = {
  data: unknown | null;
  isLoading: boolean;
  error: unknown | null;
};

interface UserStore {
  users: Record<string, User>;
  profiles: Record<string, ProfileState>;
  controllers: Record<string, AbortController>;
  addUser: (id: string, user: User) => void;
  removeUser: (id: string) => void;
  setField: (id: string, field: keyof User, value: string) => void;
  fetchProfile: (id: string, email: string) => void;
}

const useUserStore = create<UserStore>((set, get) => ({
  users: {},
  profiles: {},
  controllers: {},

  addUser: (id, user) =>
    set((s) => ({
      users: { ...s.users, [id]: user },
    })),

  removeUser: (id) =>
    set((s) => {
      const { [id]: _, ...restUsers } = s.users;
      const { [id]: __, ...restProfiles } = s.profiles;
      // Abort in-flight request
      s.controllers[id]?.abort();
      const { [id]: ___, ...restControllers } = s.controllers;
      return {
        users: restUsers,
        profiles: restProfiles,
        controllers: restControllers,
      };
    }),

  setField: (id, field, value) =>
    set((s) => ({
      users: {
        ...s.users,
        [id]: { ...s.users[id], [field]: value, lastUpdated: Date.now() },
      },
    })),

  fetchProfile: async (id, email) => {
    // Abort previous request for this user
    get().controllers[id]?.abort();
    const controller = new AbortController();
    set((s) => ({
      controllers: { ...s.controllers, [id]: controller },
      profiles: {
        ...s.profiles,
        [id]: {
          data: s.profiles[id]?.data ?? null,
          isLoading: true,
          error: null,
        },
      },
    }));

    try {
      const res = await fetch(`/api/users/${email}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      set((s) => ({
        profiles: {
          ...s.profiles,
          [id]: { data, isLoading: false, error: null },
        },
      }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        set((s) => ({
          profiles: {
            ...s.profiles,
            [id]: { data: null, isLoading: false, error: err },
          },
        }));
      }
    }
  },
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
  const email = useUserStore((s) => s.users[id]?.email ?? '');
  const firstName = useUserStore((s) => s.users[id]?.firstName ?? '');
  const lastName = useUserStore((s) => s.users[id]?.lastName ?? '');
  const role = useUserStore((s) => s.users[id]?.role ?? '');
  const profile = useUserStore((s) => s.profiles[id]);
  const setField = useUserStore((s) => s.setField);
  const fetchProfile = useUserStore((s) => s.fetchProfile);

  // Must trigger fetch manually and re-fetch on email change
  useEffect(() => {
    fetchProfile(id, email);
  }, [id, email]);

  const displayName = `${firstName} ${lastName}`;

  // "Sync reads async" — manual null check, no derivation layer
  const avatarUrl = profile?.data
    ? (profile.data as any).avatar
    : '/default-avatar.png';

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <img src={avatarUrl} />
      </td>
      <td>
        <input
          value={email}
          onChange={(e) => setField(id, 'email', e.target.value)}
        />
      </td>
      <td>{role}</td>
    </tr>
  );
}
```

Every mutation spreads the entire `users` map. Per-field selectors are required;
skip one and unrelated edits re-render the row. Async adds `profiles`,
`controllers`, and `fetchProfile` to the store — all manually managed.
`greeting` is computed inline with a null check. Abort logic is hand-written.
The fetch must be triggered imperatively via `useEffect`; there's no reactive
"re-fetch when X changes." And the store is a singleton; if you need two
independent user tables, you need a factory wrapper + context:

```ts
function createUserStore() {
  return create<UserStore>((set, get) => ({
    /* ... same 60+ lines ... */
  }));
}

const StoreContext = createContext<ReturnType<typeof createUserStore>>(null!);

function IndependentUserTable() {
  const [store] = useState(() => createUserStore());
  return (
    <StoreContext.Provider value={store}>
      <UserTable />
    </StoreContext.Provider>
  );
}
```

Compare that to ValUse: `const users = useMemo(() => user.createMap(), [])`.

---

### Jotai

Each user is a separate atom family entry, the key list requires a second atom,
and async makes everything downstream async too.

```ts
import { atom } from 'jotai';
import { atomFamily, loadable } from 'jotai/utils';

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
    firstName: '',
    lastName: '',
    email: '',
    role: 'viewer',
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
    { id, field, value }: { id: string; field: keyof User; value: string },
  ) => {
    const user = get(userAtom(id));
    set(userAtom(id), { ...user, [field]: value, lastUpdated: Date.now() });
  },
);

// Add/remove must update both the family entry and the key list
const addUser = atom(
  null,
  (get, set, { id, user }: { id: string; user: User }) => {
    set(userAtom(id), user);
    set(userIdsAtom, [...get(userIdsAtom), id]);
  },
);

const removeUser = atom(null, (get, set, id: string) => {
  set(
    userIdsAtom,
    get(userIdsAtom).filter((k) => k !== id),
  );
  // atomFamily entry is NOT cleaned up — it leaks unless you call .remove(id)
});

// Async atom — fetches profile. No AbortSignal available.
const profileAtom = atomFamily((id: string) =>
  atom(async (get) => {
    const user = get(userAtom(id));
    const res = await fetch(`/api/users/${user.email}`);
    return res.json();
  }),
);

// Sync derivation that reads async? Not possible directly.
// The derived atom MUST be async too — async is contagious.
const avatarUrlAtom = atomFamily((id: string) =>
  atom(async (get) => {
    const profile = await get(profileAtom(id)); // forced to await
    return profile.avatar ?? '/default-avatar.png';
  }),
);

// And now the component needs loadable() or Suspense for avatarUrl too
const avatarUrlLoadable = atomFamily((id: string) =>
  loadable(avatarUrlAtom(id)),
);
```

```tsx
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

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
  const [user] = useAtom(userAtom(id));
  const updateField = useSetAtom(setUserField);
  const avatarUrl = useAtomValue(avatarUrlLoadable(id));

  const displayName = `${user.firstName} ${user.lastName}`;

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <img
          src={
            avatarUrl.state === 'hasData'
              ? avatarUrl.data
              : '/default-avatar.png'
          }
        />
      </td>
      <td>
        <input
          value={user.email}
          onChange={(e) =>
            updateField({ id, field: 'email', value: e.target.value })
          }
        />
      </td>
      <td>{user.role}</td>
    </tr>
  );
}
```

Each user is its own atom (good for isolation), but the key list is a separate
atom that must be manually synchronized on every add/remove; forget and the UI
desyncs. `atomFamily` entries leak unless you explicitly call `.remove(id)`.

**Async is contagious.** `profileAtom` is async, so `avatarUrlAtom` _must_ also
be async — it has to `await get(profileAtom(id))`. And because `avatarUrlAtom`
is async, the component needs `loadable()` or a `<Suspense>` boundary just to
read an avatar URL. Every downstream atom inherits the async nature of its
dependencies. In ValUse, `avatarUrl` is a plain sync derivation — it sees
`Profile | undefined` and never touches a promise.

There's also no `AbortSignal` — stale requests run to completion and are
silently discarded. If the fetch has side effects or is expensive, you can't
cancel it. And if you need two independent user tables, you need a separate
`Provider` and `Store` for each:

```tsx
import { Provider, createStore } from 'jotai';

function IndependentUserTable() {
  const [store] = useState(() => createStore());
  return (
    <Provider store={store}>
      <UserTable />
    </Provider>
  );
}
```

Compare that to ValUse: `const users = useMemo(() => user.createMap(), [])`.
