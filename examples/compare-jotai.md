# ValUse vs Jotai

Jotai gives you atoms — tiny reactive units that compose via dependency graphs.
It's excellent for fine-grained reactivity, but structured data (an entity with
typed fields, derivations, and lifecycle) requires assembling many atoms,
keeping them in sync, and managing their lifetimes manually.

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
  displayName: ({ scope }) =>
    `${scope.firstName.use()} ${scope.lastName.use()}`,
});
```

**Jotai** — one atom per entity, derivation is another atom:

```ts
const userAtom = atomFamily((id: string) =>
  atom<User>({ firstName: '', lastName: '', email: '', role: 'viewer' }),
);

const displayNameAtom = atomFamily((id: string) =>
  atom((get) => {
    const u = get(userAtom(id));
    return `${u.firstName} ${u.lastName}`;
  }),
);
```

There's no single definition that says "a user has these fields." The model is
scattered across atoms, and adding a derivation means creating another
`atomFamily`.

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

**Jotai:**

```ts
const userIdsAtom = atom<string[]>([]);

const addUser = atom(
  null,
  (_get, set, { id, user }: { id: string; user: User }) => {
    set(userAtom(id), user);
    set(userIdsAtom, (prev) => [...prev, id]);
  },
);

const removeUser = atom(null, (_get, set, id: string) => {
  set(userIdsAtom, (prev) => prev.filter((k) => k !== id));
  // atomFamily entry leaks unless you call userAtom.remove(id)
});
```

Two atoms must stay in sync on every add/remove. Forget to update `userIdsAtom`
and the UI desyncs. Forget `userAtom.remove(id)` and the atom leaks memory.

---

## Change tracking

Track `lastUpdated` whenever any field changes.

**ValUse** — one hook, declared alongside the model:

```ts
const user = valueScope(
  { /* ...fields... */ lastUpdated: value<number>(0) },
  {
    onChange: ({ scope }) => {
      scope.lastUpdated.set(Date.now());
    },
  },
);
```

**Jotai** — duplicated in every writable atom:

```ts
const setUserField = atom(null, (get, set, { id, field, value }) => {
  const user = get(userAtom(id));
  set(userAtom(id), { ...user, [field]: value, lastUpdated: Date.now() });
});
```

Every write path must remember to timestamp. There's no centralized "on any
change" hook.

---

## Per-row isolation

Editing one user's email must not re-render other rows.

**ValUse** — automatic. Each field `.use()` subscribes to that field only:

```tsx
function UserRow({ id }: { id: string }) {
  const user = users.get(id)!;
  const [email, setEmail] = user.email.use();
  return <input value={email} onChange={(e) => setEmail(e.target.value)} />;
}
```

**Jotai** — one atom per user gives isolation, but the component needs separate
hooks for the entity and each derived value:

```tsx
function UserRow({ id }: { id: string }) {
  const user = useAtomValue(userAtom(id));
  const updateField = useSetAtom(setUserField);
  const displayName = useAtomValue(displayNameAtom(id));
  // ...
}
```

Isolation is good here — Jotai's per-atom subscriptions work well. The cost is
the proliferation of atoms and hooks needed to wire them together.

---

## Async data fetch

Fetch a user's profile by email. Abort the previous request when email changes.

**ValUse** — a derivation that happens to be async:

```ts
const user = valueScope({
  email: value<string>(),
  profile: async ({ scope, signal }) => {
    const res = await fetch(`/api/users/${scope.email.use()}`, { signal });
    return res.json();
  },
});
```

Abort is automatic. Re-fetch is reactive.

**Jotai** — async atom with abort support (since v2):

```ts
const profileAtom = atomFamily((id: string) =>
  atom(async (get, { signal }) => {
    const user = get(userAtom(id));
    const res = await fetch(`/api/users/${user.email}`, { signal });
    return res.json();
  }),
);
```

Jotai supports `AbortSignal` via the second argument to async atoms — both
libraries require you to destructure `signal` and pass it to your fetch. The
difference is in the re-run lifecycle: ValUse automatically aborts and re-runs
the derivation when any `use()` dependency changes, while Jotai's re-run
behavior is tied to the atom dependency graph.

---

## Sync reads async

Derive `avatarUrl` from the async `profile`. This should be a plain sync
computation.

**ValUse** — just another derivation. Sees `Profile | undefined`, never a
promise:

```ts
avatarUrl: ({ scope }) => scope.profile.use()?.avatar ?? '/default-avatar.png',
```

If you later change `profile` from async to sync (or vice versa), `avatarUrl`
doesn't change at all.

**Jotai** — async is contagious. `avatarUrlAtom` _must_ be async because it
reads an async atom:

```ts
const avatarUrlAtom = atomFamily((id: string) =>
  atom(async (get) => {
    const profile = await get(profileAtom(id)); // forced to await
    return profile.avatar ?? '/default-avatar.png';
  }),
);

// Component needs loadable() or Suspense just to read an avatar URL
const avatarLoadable = atomFamily((id: string) => loadable(avatarUrlAtom(id)));
```

Every downstream atom inherits the async nature of its dependencies. Jotai's
intended solution is `<Suspense>` boundaries, which work well but require
structuring your component tree around loading states. For cases where you want
inline fallbacks instead, you need `loadable()` from `jotai/utils`.

---

## Multiple independent instances

Two independent user tables, no shared state.

**ValUse:**

```ts
const tableA = user.createMap();
const tableB = user.createMap();
```

**Jotai** — separate `Provider` and `Store` per table:

```tsx
import { Provider, createStore } from 'jotai';

function IndependentTable() {
  const [store] = useState(() => createStore());
  return (
    <Provider store={store}>
      <UserTable />
    </Provider>
  );
}
```

Without a `Provider`, all atoms share the default store. Multi-instance requires
wrapping each table in its own provider.

---

## Type safety

**ValUse** — field access is fully type-checked via dot-access on the instance:

```ts
user.email.get(); // string
user.displayName.get(); // string
user.emal; // TS error — typo caught
user.displayName.set('x'); // TS error — derived fields have no set()
```

**Jotai** — each atom is typed individually, but atoms are imported by
reference. No single place lists what "a user" has. Adding a field means
creating a new atom and importing it everywhere it's used.

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
      onChange: ({ scope, changes }) => {
        scope.lastUpdated.set(Date.now());
        scope.changeCount.set((prev) => prev + changes.size);
      },
    },
  );

const trackedUser = withTracking(user);
const trackedTodo = withTracking(todo);
```

**Jotai** — higher-order atom factory:

```ts
import { atom, type WritableAtom } from 'jotai';

function withTracking<T>(baseAtom: WritableAtom<T, [T], void>) {
  const lastUpdatedAtom = atom(0);
  const changeCountAtom = atom(0);

  return atom(
    (get) => ({
      value: get(baseAtom),
      lastUpdated: get(lastUpdatedAtom),
      changeCount: get(changeCountAtom),
    }),
    (get, set, newValue: T) => {
      set(baseAtom, newValue);
      set(lastUpdatedAtom, Date.now());
      set(changeCountAtom, get(changeCountAtom) + 1);
    },
  );
}

const trackedNameAtom = withTracking(nameAtom);
```

Jotai's approach is higher-order atom factories — functions that take an atom
and return a wrapped version. This works, but the wrapper changes the value
shape (now `{ value, lastUpdated, changeCount }` instead of `T`), and writes to
the original `baseAtom` bypass the tracking entirely. There's no way to say
"extend this atom family with extra fields" — each layer is a separate
`atomFamily`.

---

## Lifecycle

Create a WebSocket on init, announce presence when observed, clean up on
destroy.

**ValUse** — two hooks with scoped `onCleanup`, declared alongside the model:

```ts
const chatRoom = valueScope(
  {
    roomId: value<string>(),
    ws: value<WebSocket | null>(null),
  },
  {
    onCreate: ({ scope, onCleanup }) => {
      const ws = new WebSocket(`/rooms/${scope.roomId.get()}`);
      scope.ws.set(ws);
      onCleanup(() => ws.close());
    },
    onUsed: ({ scope, onCleanup }) => {
      scope.ws.get()?.send(JSON.stringify({ type: 'join' }));
      onCleanup(() => scope.ws.get()?.send(JSON.stringify({ type: 'leave' })));
    },
  },
);

const rooms = chatRoom.createMap();
rooms.set('room-1', { roomId: 'room-1' }); // onCreate fires
rooms.delete('room-1'); // onCreate's onCleanup fires, WebSocket closes
```

**Jotai** — `onMount` for lazy activation, manual cleanup for removal:

```ts
const roomAtom = atomFamily((roomId: string) => {
  const messagesAtom = atom<Message[]>([]);

  messagesAtom.onMount = (setAtom) => {
    // Fires when first subscriber attaches
    const ws = new WebSocket(`/rooms/${roomId}`);
    ws.onmessage = (e) => setAtom((prev) => [...prev, JSON.parse(e.data)]);

    // Cleanup fires when last subscriber detaches
    return () => ws.close();
  };

  return messagesAtom;
});

// Family entry cleanup is separate — must call manually
roomAtom.remove('room-1');
```

Jotai's `onMount` handles lazy activation well — it fires when the first
subscriber attaches and its return function fires when the last detaches. The
limitation is that `onMount` only receives `setAtom` — you cannot read or write
other atoms during initialization. Cleanup and family removal are two separate
mechanisms: `onMount`'s return handles side effects, but you must separately
call `atomFamily.remove(key)` to free the cached atom reference.

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

  hasSpecialTag: ({ scope }) =>
    scope.tags.use().some((t) => scope.specialTags.use().has(t)),
});

// Per-instance ref — each board gets its own column map
const column = valueScope({ id: value<string>(), name: value<string>() });

const board = valueScope({
  boardId: value<string>(),
  columns: valueRef(() => column.createMap()),
  columnCount: ({ scope }) => scope.columns.use().size,
});

const a = board.create({ boardId: 'a' });
const b = board.create({ boardId: 'b' });
// a and b each have independent column maps
```

**Jotai** — any atom can `get()` any other atom:

```ts
const globalTagsAtom = atom(new Set(['admin', 'root']));

const personAtom = atomFamily((id: string) =>
  atom({ name: '', tagIds: [] as string[] }),
);

const hasSpecialTagAtom = atomFamily((id: string) =>
  atom((get) => {
    const person = get(personAtom(id));
    const tags = get(globalTagsAtom);
    return person.tagIds.some((t) => tags.has(t));
  }),
);
```

This is one of Jotai's strengths — any atom can read any other atom via `get()`,
and Jotai tracks the dependency automatically. Changes to `globalTagsAtom`
re-derive every person's `hasSpecialTagAtom`. The tradeoff is that there's no
structural boundary — the dependency is implicit in the code, and the "model" is
spread across multiple atom families. There's also no per-instance nested state
concept — you'd need another `atomFamily` for each board's columns and manage
the relationship manually.

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

    displayName: ({ scope }) =>
      `${scope.firstName.use()} ${scope.lastName.use()}`,

    profile: async ({ scope, signal }) => {
      const res = await fetch(`/api/users/${scope.email.use()}`, { signal });
      return res.json();
    },

    avatarUrl: ({ scope }) =>
      scope.profile.use()?.avatar ?? '/default-avatar.png',
  },
  {
    onChange: ({ scope }) => {
      scope.lastUpdated.set(Date.now());
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
  const user = users.get(id)!;
  const [displayName] = user.displayName.use();
  const [avatarUrl] = user.avatarUrl.use();
  const [email, setEmail] = user.email.use();
  const [role] = user.role.use();

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <img src={avatarUrl} />
      </td>
      <td>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </td>
      <td>{role}</td>
    </tr>
  );
}
```

### Jotai

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

const userAtom = atomFamily((id: string) =>
  atom<User>({
    firstName: '',
    lastName: '',
    email: '',
    role: 'viewer',
    lastUpdated: 0,
  }),
);

const userIdsAtom = atom<string[]>([]);

const displayNameAtom = atomFamily((id: string) =>
  atom((get) => {
    const u = get(userAtom(id));
    return `${u.firstName} ${u.lastName}`;
  }),
);

const setUserField = atom(
  null,
  (
    get,
    set,
    {
      id,
      field,
      value,
    }: { id: string; field: keyof User; value: User[keyof User] },
  ) => {
    const user = get(userAtom(id));
    set(userAtom(id), { ...user, [field]: value, lastUpdated: Date.now() });
  },
);

const addUser = atom(
  null,
  (_get, set, { id, user }: { id: string; user: User }) => {
    set(userAtom(id), user);
    set(userIdsAtom, (prev) => [...prev, id]);
  },
);

const removeUser = atom(null, (_get, set, id: string) => {
  set(userIdsAtom, (prev) => prev.filter((k) => k !== id));
  // atomFamily entry leaks unless you call userAtom.remove(id)
});

const profileAtom = atomFamily((id: string) =>
  atom(async (get, { signal }) => {
    const user = get(userAtom(id));
    const res = await fetch(`/api/users/${user.email}`, { signal });
    return res.json();
  }),
);

const avatarUrlAtom = atomFamily((id: string) =>
  atom(async (get) => {
    const profile = await get(profileAtom(id));
    return profile.avatar ?? '/default-avatar.png';
  }),
);

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
  const user = useAtomValue(userAtom(id));
  const updateField = useSetAtom(setUserField);
  const displayName = useAtomValue(displayNameAtom(id));
  const avatar = useAtomValue(avatarUrlLoadable(id));

  return (
    <tr>
      <td>{displayName}</td>
      <td>
        <img
          src={avatar.state === 'hasData' ? avatar.data : '/default-avatar.png'}
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

Seven atom definitions to represent one entity. `userIdsAtom` must be manually
synced on every add/remove. Async infects `avatarUrlAtom`, which forces
`loadable()` in the component. Family entries leak on delete.
