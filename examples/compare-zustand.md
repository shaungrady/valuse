# ValUse vs Zustand

Zustand gives you a single store with getters, setters, and selectors. It's
simple to start with, but structured data — collections of entities with
per-item derived state, change tracking, and async — requires increasingly
manual wiring.

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

**Zustand** — type, store, and derived state are separate concepts:

```ts
type User = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

const useUserStore = create<{ users: Record<string, User> }>((set) => ({
  users: {},
}));

// displayName? Computed in the component. Or write a selector.
```

There's no place in the store definition where `displayName` lives. It's either
inline in every component that needs it, or a selector function defined
elsewhere.

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

**Zustand:**

```ts
const useUserStore = create((set) => ({
  users: {} as Record<string, User>,
  addUser: (id: string, user: User) =>
    set((s) => ({ users: { ...s.users, [id]: user } })),
  removeUser: (id: string) =>
    set((s) => {
      const { [id]: _, ...rest } = s.users;
      return { users: rest };
    }),
}));
```

Every mutation spreads the entire `users` object. Each operation is a new method
on the store.

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

**Zustand** — duplicated in every setter:

```ts
setField: (id, field, value) =>
  set((s) => ({
    users: {
      ...s.users,
      [id]: { ...s.users[id], [field]: value, lastUpdated: Date.now() },
    },
  })),
```

Add a new setter? Remember to include `lastUpdated`. Forget once and tracking
silently breaks.

---

## Per-row isolation

Editing one user's email must not re-render other rows.

**ValUse** — automatic. Each `users.use(id)` subscribes to that instance only:

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

**Zustand** — requires selectors. Either one per field, or a shallow-compared
object selector:

```tsx
function UserRow({ id }: { id: string }) {
  // Option A: per-field selectors (most granular, most verbose)
  const email = useUserStore((s) => s.users[id]?.email ?? '');
  const firstName = useUserStore((s) => s.users[id]?.firstName ?? '');

  // Option B: useShallow for a grouped selector (less verbose, still manual)
  const { email, firstName, lastName, role } = useUserStore(
    useShallow(
      (s) =>
        s.users[id] ?? { email: '', firstName: '', lastName: '', role: '' },
    ),
  );

  const setField = useUserStore((s) => s.setField);
  // ...
}
```

Either way, you're writing selectors manually. Per-field gives the finest
granularity; `useShallow` groups them but still re-renders when any selected
field changes.

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

Abort is automatic. Re-fetch is reactive — change `email`, previous request
aborts, new one starts.

**Zustand** — manual AbortController, manual state fields, imperative trigger:

```ts
// AbortControllers kept outside the store — non-serializable, non-reactive
const controllers = new Map<string, AbortController>();

const useUserStore = create((set) => ({
  profiles: {} as Record<
    string,
    { data: unknown; isLoading: boolean; error: unknown }
  >,

  fetchProfile: async (id: string, email: string) => {
    controllers.get(id)?.abort();
    const controller = new AbortController();
    controllers.set(id, controller);
    set((s) => ({
      profiles: {
        ...s.profiles,
        [id]: { data: s.profiles[id]?.data, isLoading: true, error: null },
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

// In component — must trigger manually:
useEffect(() => {
  fetchProfile(id, email);
}, [id, email, fetchProfile]);
```

Manual loading/error state, a `try`/`catch` with abort guard, and a `useEffect`
to trigger the fetch. None of this is reactive — the component must know when to
call `fetchProfile`.

---

## Sync reads async

Derive `avatarUrl` from the async `profile`. This should be a plain sync
computation.

**ValUse** — just another derivation. Sees `Profile | undefined`, never a
promise:

```ts
avatarUrl: ({ use }) => use('profile')?.avatar ?? '/default-avatar.png',
```

If you later change `profile` from async to sync (or vice versa), `avatarUrl`
doesn't change at all.

**Zustand** — no derivation layer. Computed inline with null checks:

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

**Zustand** — factory wrapper + context provider:

```ts
function createUserStore() {
  return create<UserStore>((set, get) => ({
    /* ...same 60+ lines... */
  }));
}

const StoreContext = createContext<ReturnType<typeof createUserStore>>(null!);

function IndependentTable() {
  const [store] = useState(() => createUserStore());
  return (
    <StoreContext.Provider value={store}>
      <UserTable />
    </StoreContext.Provider>
  );
}
```

Zustand stores are singletons by default. Multi-instance requires a factory, a
context, and a provider per instance.

---

## Type safety

**ValUse** — string keys are fully type-checked:

```ts
getUser('email'); // string
getUser('displayName'); // string
getUser('emal'); // TS error — typo caught
setUser('displayName'); // TS error — it's derived, not settable
```

**Zustand** — `setField(id, 'email', value)` accepts any string for the field
name at runtime. Type safety depends on how carefully the store interface is
written and how disciplined the selectors are.

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

// Apply to any scope — fields, derivations, and lifecycle compose
const trackedUser = withTracking(user);
const trackedTodo = withTracking(todo);
```

**Zustand** — custom middleware wrapping `set`:

```ts
import { type StateCreator, type StoreMutatorIdentifier } from 'zustand';

const tracking =
  <T, Mps extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, Mps>,
  ): StateCreator<T & { lastUpdated: number; changeCount: number }, Mps> =>
  (set, get, store) => {
    const trackedSet: typeof set = (...args) => {
      set(...(args as Parameters<typeof set>));
      set({
        lastUpdated: Date.now(),
        changeCount: ((get() as any).changeCount ?? 0) + 1,
      } as any);
    };
    return {
      ...initializer(trackedSet, get, store),
      lastUpdated: 0,
      changeCount: 0,
    };
  };

const useUserStore = create(
  tracking((set) => ({
    name: '',
    setName: (name: string) => set({ name }),
  })),
);
```

Zustand's middleware pattern is powerful — `devtools`, `persist`, and `immer`
are all built this way. The tradeoff is that the type signature for custom
middleware is complex (the `StoreMutatorIdentifier` generics are notoriously
difficult), and most custom implementations resort to `as any` casts.

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

**Zustand** — imperative logic in action methods:

```ts
const connections = new Map<string, WebSocket>();

const useRoomStore = create((set, get) => ({
  rooms: {} as Record<string, { roomId: string }>,

  addRoom: (id: string) => {
    // "onInit" — manual, inside the action
    const ws = new WebSocket(`/rooms/${id}`);
    connections.set(id, ws);
    set((s) => ({ rooms: { ...s.rooms, [id]: { roomId: id } } }));
  },

  removeRoom: (id: string) => {
    // "onDestroy" — manual, must remember to clean up
    connections.get(id)?.close();
    connections.delete(id);
    set((s) => {
      const { [id]: _, ...rest } = s.rooms;
      return { rooms: rest };
    });
  },
}));
```

Zustand has no entity lifecycle. Init and cleanup logic lives inside action
methods. Side-effect resources (WebSockets, timers, controllers) must be tracked
outside the store. There's no "start when first subscribed, stop when last
unsubscribes" — lazy activation requires manually wrapping `subscribe` with
reference counting.

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

**Zustand** — normalized IDs in one store, or `getState()` across stores:

```ts
// Single store with normalized state — IDs as references
const useBoardStore = create((set, get) => ({
  boards: {} as Record<string, { name: string; columnIds: string[] }>,
  columns: {} as Record<string, { id: string; title: string }>,

  getBoardColumns: (boardId: string) => {
    const { boards, columns } = get();
    return (
      boards[boardId]?.columnIds.map((id) => columns[id]).filter(Boolean) ?? []
    );
  },
}));

// Or separate stores — cross-reference via getState()
const useTagStore = create(() => ({
  tags: new Set(['admin', 'root']),
}));

const usePersonStore = create((set, get) => ({
  persons: {} as Record<string, { name: string; tagIds: string[] }>,

  hasSpecialTag: (personId: string) => {
    const tags = useTagStore.getState().tags; // point-in-time read
    return get().persons[personId]?.tagIds.some((t) => tags.has(t)) ?? false;
  },
}));
```

Zustand uses normalized state (ID references) within a single store, or
`getState()` across stores. Neither provides reactive cross-store references —
`getState()` is a point-in-time read, and `getBoardColumns` returns a new array
on every call with no memoization. Components that need reactivity across stores
must subscribe to each independently. There's no concept of per-instance nested
state — every entity shares the same flat store.

---

## The full picture

All concerns combined — model, collection, derivations, change tracking, async
with abort, and React components.

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

### Zustand

```ts
import { create } from 'zustand';
import { shallow } from 'zustand/shallow';

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

interface UserStore {
  users: Record<string, User>;
  profiles: Record<string, ProfileState>;
  addUser: (id: string, user: User) => void;
  removeUser: (id: string) => void;
  setField: <K extends keyof User>(
    id: string,
    field: K,
    value: User[K],
  ) => void;
  fetchProfile: (id: string, email: string) => void;
}

// AbortControllers kept outside the store — non-serializable, non-reactive
const controllers = new Map<string, AbortController>();

const useUserStore = create<UserStore>((set, get) => ({
  users: {},
  profiles: {},

  addUser: (id, user) =>
    set((s) => ({
      users: { ...s.users, [id]: user },
    })),

  removeUser: (id) =>
    set((s) => {
      const { [id]: _, ...restUsers } = s.users;
      const { [id]: __, ...restProfiles } = s.profiles;
      controllers.get(id)?.abort();
      controllers.delete(id);
      return { users: restUsers, profiles: restProfiles };
    }),

  setField: (id, field, value) =>
    set((s) => ({
      users: {
        ...s.users,
        [id]: { ...s.users[id], [field]: value, lastUpdated: Date.now() },
      },
    })),

  fetchProfile: async (id, email) => {
    controllers.get(id)?.abort();
    const controller = new AbortController();
    controllers.set(id, controller);
    set((s) => ({
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
  const ids = useUserStore((s) => Object.keys(s.users), shallow);
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

  useEffect(() => {
    fetchProfile(id, email);
  }, [id, email, fetchProfile]);

  const displayName = `${firstName} ${lastName}`;
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
          value={email}
          onChange={(e) => setField(id, 'email', e.target.value)}
        />
      </td>
      <td>{role}</td>
    </tr>
  );
}
```

Three type definitions, a store with six methods, manual abort tracking,
per-field selectors in every row (with `shallow` for the key list), `useEffect`
to trigger fetches, and `displayName`/`avatarUrl` computed inline.
