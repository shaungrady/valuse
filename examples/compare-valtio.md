# ValUse vs Valtio

Valtio gives you proxy-based state — mutate a plain object and the UI reacts.
It's the simplest API of any state library. But that simplicity comes with
tradeoffs: no structured model, no per-entity derivations (though `derive()`
from `valtio/utils` works at the store level), no lifecycle hooks, and no
collections. As requirements grow, Valtio's "just mutate" model requires
increasingly manual wiring.

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

**Valtio** — proxy object, no derivation concept:

```ts
const state = proxy({
  users: {} as Record<
    string,
    {
      firstName: string;
      lastName: string;
      email: string;
      role: string;
    }
  >,
});

// displayName? Computed in the component, or use derive() from valtio/utils:
import { derive } from 'valtio/utils';

const derived = derive({
  displayNames: (get) => {
    const users = get(state).users;
    return Object.fromEntries(
      Object.entries(users).map(([id, u]) => [
        id,
        `${u.firstName} ${u.lastName}`,
      ]),
    );
  },
});
```

Valtio's `derive()` operates on the entire proxy, not per entity. There's no way
to define "a user has these fields and this derived state" as a reusable
template.

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

**Valtio:**

```ts
state.users['alice'] = {
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@co',
  role: 'viewer',
};
delete state.users['alice'];
'bob' in state.users;
```

Mutation syntax is clean — this is Valtio's strength. But there's no validation,
no defaults, no lifecycle on add/remove. You must always provide every field (or
risk `undefined` values), and there's no `onDestroy` equivalent when an entry is
deleted.

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

**Valtio** — `subscribe()` per nested proxy:

```ts
// Subscribe to a specific user — nested objects are also proxies
subscribe(state.users['alice'], () => {
  state.users['alice'].lastUpdated = Date.now();
});
```

Valtio does support per-entity subscription via nested proxies. The difference
is co-location: ValUse declares `onChange` once in the model and every instance
created via `createMap()` gets it automatically. With Valtio, you wire up
`subscribe()` per entry in your factory function. There's also no `changes` map
telling you which fields changed or what the previous values were.

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

**Valtio** — `useSnapshot()` on the nested proxy gives per-row isolation:

```tsx
function UserRow({ id }: { id: string }) {
  const user = useSnapshot(state.users[id]);

  return (
    <input
      value={user.email}
      onChange={(e) => {
        state.users[id].email = e.target.value;
      }}
    />
  );
}
```

This works well — Valtio's nested proxies let you scope subscriptions to a
single entry. The caveat: the parent list component that calls
`useSnapshot(state)` and reads `Object.keys(snap.users)` will re-render on any
user field change, not just add/remove. Separating the key-list subscription
from per-row rendering requires careful component splitting.

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

**Valtio** — no async primitive. Manual fetch, manual state, manual abort:

```ts
async function fetchProfile(id: string) {
  const user = state.users[id];
  if (!user) return;

  state.profiles[id] = { data: null, isLoading: true, error: null };

  // Abort? You need your own controller map.
  try {
    const res = await fetch(`/api/users/${user.email}`);
    state.profiles[id] = {
      data: await res.json(),
      isLoading: false,
      error: null,
    };
  } catch (err) {
    state.profiles[id] = { data: null, isLoading: false, error: err };
  }
}

// Must trigger manually and re-trigger on email change via subscribe() or useEffect
```

No reactive re-fetch, no abort, no loading state integration. You're back to
imperative async management.

---

## Sync reads async

Derive `avatarUrl` from the async `profile`.

**ValUse** — just another derivation:

```ts
avatarUrl: ({ use }) => use('profile')?.avatar ?? '/default-avatar.png',
```

**Valtio** — inline in the component:

```tsx
const avatarUrl = state.profiles[id]?.data?.avatar ?? '/default-avatar.png';
```

No derivation layer, so this is duplicated wherever you need it.

---

## Multiple independent instances

Two independent user tables, no shared state.

**ValUse:**

```ts
const tableA = user.createMap();
const tableB = user.createMap();
```

**Valtio** — separate proxy per table:

```ts
const tableA = proxy({ users: {} as Record<string, User> });
const tableB = proxy({ users: {} as Record<string, User> });
```

This works, but there's no shared model definition. Both proxies must
independently maintain the same shape, and any factory logic (defaults,
validation, lifecycle) must be duplicated or extracted into a helper.

---

## Type safety

**ValUse** — string keys are fully type-checked:

```ts
getUser('email'); // string
getUser('displayName'); // string
getUser('emal'); // TS error — typo caught
setUser('displayName'); // TS error — it's derived, not settable
```

**Valtio** — direct property access is typed:

```ts
state.users['alice'].email; // string
state.users['alice'].emal; // TS error
```

Property access gives good type safety. The gap appears when you need to
constrain _which_ properties are writable — Valtio has no concept of read-only
derived fields at the type level.

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

**Valtio** — factory function with `subscribe()`:

```ts
import { proxy, subscribe } from 'valtio';

function withTracking<T extends object>(initial: T) {
  const state = proxy({
    ...initial,
    lastUpdated: 0,
    changeCount: 0,
  });

  subscribe(state, () => {
    state.lastUpdated = Date.now();
    state.changeCount++;
  });

  return state;
}

const user = withTracking({ name: '', email: '' });
user.name = 'Alice'; // lastUpdated and changeCount update
```

Valtio's proxy model makes this pattern simple — spread the base shape, add
tracking fields, wire up `subscribe()`. No special API needed. The tracking
fields updating inside the callback triggers another notification cycle, which
Valtio batches but can be a subtle footgun. The bigger gap is that there's no
reusable "model" that carries derivations and lifecycle together —
`withTracking` only adds fields and a subscription, not derived state.

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

**Valtio** — factory functions with manual cleanup:

```ts
import { proxy } from 'valtio';

const rooms = proxy<Record<string, { roomId: string; messages: Message[] }>>(
  {},
);
const connections = new Map<string, WebSocket>();

function addRoom(id: string) {
  const ws = new WebSocket(`/rooms/${id}`);
  ws.onmessage = (e) => rooms[id].messages.push(JSON.parse(e.data));
  connections.set(id, ws);
  rooms[id] = { roomId: id, messages: [] };
}

function removeRoom(id: string) {
  // Must call before delete — no automatic teardown
  connections.get(id)?.close();
  connections.delete(id);
  delete rooms[id];
}

// Lazy activation? Manual ref-counting — no built-in API.
```

Valtio has no lifecycle hooks. Init and cleanup are factory functions you write
yourself. Side-effect resources live outside the proxy. If you
`delete rooms[id]` without calling cleanup first, the WebSocket leaks. There's
no equivalent to `onUsed`/`onUnused` — lazy activation requires manual reference
counting wired to React's `useEffect`.

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

**Valtio** — direct proxy references:

```ts
import { proxy } from 'valtio';

const globalTags = proxy({ items: new Set(['admin', 'root']) });

function createPerson(name: string) {
  return proxy({
    name,
    tags: new Set<string>(),
    get hasSpecialTag() {
      return [...this.tags].some((t) => globalTags.items.has(t));
    },
  });
}

// Per-instance nested state — create in the factory
function createBoard(boardId: string) {
  return proxy({
    boardId,
    columns: {} as Record<string, { id: string; title: string }>,
    get columnCount() {
      return Object.keys(this.columns).length;
    },
  });
}
```

Valtio handles shared references naturally — proxies are mutable objects with
identity, so referencing the same proxy from multiple places just works. The
`hasSpecialTag` getter reads from both `this.tags` and `globalTags`, and
`useSnapshot()` tracks both during render. The caveat: cross-proxy reactivity
only works inside React's render via `useSnapshot()`. A `subscribe(person, ...)`
call will _not_ fire when `globalTags` changes — only when `person`'s own
properties change.

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

### Valtio

```ts
import { proxy, useSnapshot, subscribe } from 'valtio';

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

const state = proxy({
  users: {} as Record<string, User>,
  profiles: {} as Record<string, ProfileState>,
});

function addUser(id: string, data: Omit<User, 'lastUpdated'>) {
  state.users[id] = { ...data, lastUpdated: Date.now() };
}

function removeUser(id: string) {
  delete state.users[id];
  delete state.profiles[id];
}

function setField<K extends keyof User>(id: string, field: K, value: User[K]) {
  state.users[id][field] = value;
  state.users[id].lastUpdated = Date.now();
}

async function fetchProfile(id: string) {
  const user = state.users[id];
  if (!user) return;
  state.profiles[id] = { data: null, isLoading: true, error: null };
  try {
    const res = await fetch(`/api/users/${user.email}`);
    state.profiles[id] = {
      data: await res.json(),
      isLoading: false,
      error: null,
    };
  } catch (err) {
    state.profiles[id] = { data: null, isLoading: false, error: err };
  }
}
```

```tsx
function UserTable() {
  const snap = useSnapshot(state);
  const ids = Object.keys(snap.users);

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
  const user = useSnapshot(state.users[id]);
  const snap = useSnapshot(state);
  const profile = snap.profiles[id];

  // Must trigger fetch manually
  useEffect(() => {
    fetchProfile(id);
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
          onChange={(e) => setField(id, 'email', e.target.value)}
        />
      </td>
      <td>{user.role}</td>
    </tr>
  );
}
```

Valtio's mutation API is clean, but adding structured concerns — derivations,
change tracking, async, per-row isolation — requires the same manual wiring as
any non-reactive approach. The proxy makes writes easy; everything else is on
you.
