# ValUse vs React Context

React Context is the "no library" baseline — `useReducer` + `createContext`, no
external dependencies. It works, but it was designed for infrequently changing
values (theme, locale, auth), not fine-grained state management. Using it for
structured, frequently updating data exposes fundamental limitations around
re-rendering, isolation, and code organization.

All examples below build the same user model: `firstName`, `lastName`, `email`,
`role`, a derived `displayName`, change tracking via `lastUpdated`, and an async
`profile` fetch.

## Table of contents

- [Define a model](#define-a-model)
- [Collection CRUD](#collection-crud)
- [Change tracking](#change-tracking)
- [Per-row isolation](#per-row-isolation)
- [Async data fetch](#async-data-fetch)
- [Sync reads async](#sync-reads-async)
- [Multiple independent instances](#multiple-independent-instances)
- [Type safety](#type-safety)
- [Extending and reuse](#extending-and-reuse)
- [Lifecycle](#lifecycle)
- [Shared and nested state](#shared-and-nested-state)
- [The full picture](#the-full-picture)

---

## Define a model

**ValUse** — fields and derivations in one place:

```ts
const user = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  email: value<string>(),
  role: value<string>('viewer'),
  displayName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
});
```

**Context** — type alias, then a reducer to come:

```ts
type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

// displayName? Computed inline in the component.
// No place to define derived state alongside the model.
```

The type definition describes the shape, but there's no concept of defaults,
derivations, or lifecycle attached to it.

---

## Collection CRUD

**ValUse:**

```ts
const users = user.createMap();

users.set('alice', {
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@co',
});
users.delete('alice');
users.has('bob');
```

**Context:**

```ts
type Action =
  | { type: 'ADD'; id: string; user: User }
  | { type: 'REMOVE'; id: string }
  | { type: 'SET_FIELD'; id: string; field: keyof User; value: string };

function reducer(state: Record<string, User>, action: Action) {
  switch (action.type) {
    case 'ADD':
      return { ...state, [action.id]: action.user };
    case 'REMOVE': {
      const { [action.id]: _, ...rest } = state;
      return rest;
    }
    case 'SET_FIELD':
      return {
        ...state,
        [action.id]: { ...state[action.id], [action.field]: action.value },
      };
  }
}
```

Action types grow linearly with operations. Every new operation means a new
action type, a new reducer case, and a new spread.

---

## Change tracking

Track `lastUpdated` whenever any field changes.

**ValUse** — one hook, declared alongside the model:

```ts
const user = valueScope(
  { /* ...fields... */ lastUpdated: value<number>(0) },
  {
    onChange: ({ set }) => {
      set('lastUpdated', Date.now());
    },
  },
);
```

**Context** — duplicated in every reducer case:

```ts
case 'SET_FIELD':
  return {
    ...state,
    [action.id]: {
      ...state[action.id],
      [action.field]: action.value,
      lastUpdated: Date.now(),  // must add to every case
    },
  };
```

Every reducer case that modifies a user must remember to update `lastUpdated`.

---

## Per-row isolation

Editing one user's email must not re-render other rows.

**ValUse** — automatic:

```tsx
function UserRow({ id }: { id: string }) {
  const [getUser, setUser] = users.use(id);
  return (
    <input
      value={getUser('email')}
      onChange={(e) => setUser('email', e.target.value)}
    />
  );
}
```

**Context** — requires `memo` and split contexts. Even then, isolation is
incomplete:

```tsx
const UsersContext = createContext<Record<string, User>>({});
const DispatchContext = createContext<React.Dispatch<Action>>(() => {});

const UserRow = memo(function UserRow({ id }: { id: string }) {
  const users = useContext(UsersContext);
  const dispatch = useContext(DispatchContext);
  const user = users[id];
  // ...
});
```

`memo` prevents re-renders from parent props, but `useContext(UsersContext)`
subscribes to the entire state object. Any change to _any_ user triggers a
re-render in _every_ row. True per-row isolation requires splitting into
per-user contexts — a provider per row — which is impractical.

---

## Async data fetch

Fetch a user's profile by email. Abort the previous request when email changes.

**ValUse** — a derivation that happens to be async:

```ts
const user = valueScope({
  email: value<string>(),
  profile: async ({ use, signal }) => {
    const res = await fetch(`/api/users/${use('email')}`, { signal });
    return res.json();
  },
});
```

Abort is automatic. Re-fetch is reactive.

**Context** — manual AbortController inside `useEffect`:

```tsx
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
```

Manual AbortController, three dispatch calls for loading/success/error, a new
action type and reducer case for `SET_PROFILE`, a separate `profiles` state
alongside `users`. All per component.

---

## Sync reads async

Derive `avatarUrl` from the async `profile`.

**ValUse** — just another derivation:

```ts
avatarUrl: ({ use }) => use('profile')?.avatar ?? '/default-avatar.png',
```

**Context** — inline in the component:

```tsx
const avatarUrl =
  profile?.data ? (profile.data as any).avatar : '/default-avatar.png';
```

Per-component, untyped, and duplicated wherever you need it.

---

## Multiple independent instances

Two independent user tables, no shared state.

**ValUse:**

```ts
const tableA = user.createMap();
const tableB = user.createMap();
```

**Context** — already scoped to a provider, but everything else must be
duplicated or parameterized:

```tsx
// Each table needs its own useReducer + two providers
function IndependentTable() {
  const [state, dispatch] = useReducer(reducer, {});
  return (
    <UsersContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <UserTable />
      </DispatchContext.Provider>
    </UsersContext.Provider>
  );
}
```

Context is naturally scoped per provider, which is a strength. But the reducer,
action types, and contexts are all tightly coupled to the component tree.

---

## Type safety

**ValUse** — string keys are fully type-checked:

```ts
getUser('email'); // string
getUser('displayName'); // string
getUser('emal'); // TS error — typo caught
setUser('displayName'); // TS error — it's derived, not settable
```

**Context** — `dispatch({ field: 'email' })` is only as safe as the `Action`
union. String literal unions help, but the reducer typically uses `keyof` with
casts, and there's no compile-time distinction between settable and derived
fields.

---

## Extending and reuse

Add tracking to any scope without modifying the original.

**ValUse** — `.extend()` returns a new scope with additional state and
lifecycle:

```ts
const withTracking = (scope) =>
  scope.extend(
    {
      lastUpdated: value<number>(0),
      changeCount: value<number>(0),
    },
    {
      onChange: ({ changes, set }) => {
        set('lastUpdated', Date.now());
        set('changeCount', (prev) => prev + changes.size);
      },
    },
  );

const trackedUser = withTracking(user);
const trackedTodo = withTracking(todo);
```

**Context** — higher-order reducer:

```ts
type Tracked<S> = S & { lastUpdated: number; changeCount: number };

function withTracking<S, A>(
  reducer: React.Reducer<S, A>,
): React.Reducer<Tracked<S>, A> {
  return (state, action) => {
    const next = reducer(state, action);
    if (next === state) return state;
    return {
      ...next,
      lastUpdated: Date.now(),
      changeCount: state.changeCount + 1,
    };
  };
}

const trackedReducer = withTracking(userReducer);
const [state, dispatch] = useReducer(trackedReducer, {
  ...initialUserState,
  lastUpdated: 0,
  changeCount: 0,
});
```

Higher-order reducers are a clean pattern borrowed from Redux. But the caller
must provide the initial tracking fields, action type discrimination can break
down when composing reducers (often leading to `as` casts), and each composition
layer creates a new object even if nothing changed — defeating React's bailout
optimization without manual `Object.is` checks.

---

## Lifecycle

Create a WebSocket on init, announce presence when observed, clean up on
destroy.

**ValUse** — four hooks, declared alongside the model:

```ts
const chatRoom = valueScope(
  {
    roomId: value<string>(),
    ws: value<WebSocket | null>(null),
  },
  {
    onInit: ({ set, get }) => {
      set('ws', new WebSocket(`/rooms/${get('roomId')}`));
    },
    onUsed: ({ get }) => {
      get('ws')?.send(JSON.stringify({ type: 'join' }));
    },
    onUnused: ({ get }) => {
      get('ws')?.send(JSON.stringify({ type: 'leave' }));
    },
    onDestroy: ({ get }) => {
      get('ws')?.close();
    },
  },
);

const rooms = chatRoom.createMap();
rooms.set('room-1', { roomId: 'room-1' }); // onInit fires
rooms.delete('room-1'); // onDestroy fires, WebSocket closes
```

**Context** — `useEffect` tied to component lifecycle:

```tsx
function ChatRoom({ roomId }: { roomId: string }) {
  const { dispatch } = useContext(ChatContext);

  useEffect(() => {
    // Setup — tied to component mount, not data creation
    const ws = new WebSocket(`/rooms/${roomId}`);
    ws.onmessage = (e) =>
      dispatch({ type: 'MESSAGE', roomId, message: JSON.parse(e.data) });
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join' }));

    return () => {
      // Cleanup — tied to component unmount, not data removal
      ws.send(JSON.stringify({ type: 'leave' }));
      ws.close();
    };
  }, [roomId, dispatch]);

  return /* ... */;
}
```

React's `useEffect` is the lifecycle mechanism — setup on mount, cleanup on
unmount. This ties lifecycle to the component tree, not the data. If you remove
a room from state, nothing automatically cleans up — cleanup only fires when the
component rendering that room unmounts. Init and cleanup logic live in entirely
different places (reducer vs. effect), and there's no "start when first
subscribed, stop when last unsubscribes" without manual reference counting.

---

## Shared and nested state

A person with tags that derive from a shared global set. A board where each
instance gets its own column collection.

**ValUse** — `valueRef` for shared state, factory refs for per-instance state:

```ts
const globalTags = valueSet<string>(['admin', 'root']);

const person = valueScope({
  name: value<string>(),
  tags: valueSet<string>(),
  specialTags: valueRef(globalTags),

  hasSpecialTag: ({ use }) =>
    use('tags').some((t) => use('specialTags').has(t)),
});

// Per-instance ref — each board gets its own column map
const column = valueScope({ id: value<string>(), name: value<string>() });

const board = valueScope({
  boardId: value<string>(),
  columns: valueRef(() => column.createMap()),
  columnCount: ({ use }) => use('columns').size,
});

const a = board.create({ boardId: 'a' });
const b = board.create({ boardId: 'b' });
// a and b each have independent column maps
```

**Context** — multiple providers, consumed separately:

```tsx
const GlobalTagsContext = createContext<Set<string>>(new Set());

function PersonCard({ person }: { person: Person }) {
  const globalTags = useContext(GlobalTagsContext);

  const hasSpecialTag = useMemo(
    () => person.tagIds.some((t) => globalTags.has(t)),
    [person.tagIds, globalTags],
  );

  return <div>{hasSpecialTag ? 'Special' : 'Regular'}</div>;
}
```

Multiple contexts work, but every consumer of `GlobalTagsContext` re-renders
when any tag changes — there's no selector mechanism. Derived state that spans
contexts must be computed inline with `useMemo`, duplicated wherever you need
it. For per-instance nested state, you'd need a separate `useReducer` + provider
per board, with no shared model definition between them.

---

## The full picture

All concerns combined.

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

    profile: async ({ use, signal }) => {
      const res = await fetch(`/api/users/${use('email')}`, { signal });
      return res.json();
    },

    avatarUrl: ({ use }) => use('profile')?.avatar ?? '/default-avatar.png',
  },
  {
    onChange: ({ set }) => {
      set('lastUpdated', Date.now());
    },
  },
);

const users = user.createMap();
```

```tsx
function UserTable() {
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

### React Context

```tsx
import { createContext, useContext, useReducer, useEffect, memo } from 'react';

type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  lastUpdated: number;
};

type ProfileState = {
  data: unknown;
  isLoading: boolean;
  error: unknown;
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
  }, [id, user.email]);

  const displayName = `${user.firstName} ${user.lastName}`;
  const avatarUrl =
    profile?.data ? (profile.data as any).avatar : '/default-avatar.png';

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

Four type definitions, a reducer that grows with every action, two contexts,
`memo` that doesn't fully isolate rows, manual AbortController + `useEffect` per
async source, `displayName` and `avatarUrl` computed inline. None of the state
logic works outside React.
