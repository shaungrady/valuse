# ValUse vs MobX

MobX is the closest philosophical match — observable objects with computed
values and reactions. It pioneered fine-grained reactivity in React. But MobX
uses classes, decorators, and proxy magic where ValUse uses plain objects and
explicit `use()` calls. And MobX has no built-in collection primitive and no
async derivation with abort. It does have lifecycle hooks
(`onBecomeObserved`/`onBecomeUnobserved`) and `reaction()` for responding to
changes, though they're set up separately from the model definition.

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

**ValUse** — fields and derivations in one place, plain object:

```ts
const user = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  email: value<string>(),
  role: value<string>('viewer'),
  displayName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
});
```

**MobX** — class with decorators or `makeObservable`:

```ts
class UserModel {
  firstName = '';
  lastName = '';
  email = '';
  role = 'viewer';

  constructor() {
    makeAutoObservable(this);
  }

  get displayName() {
    return `${this.firstName} ${this.lastName}`;
  }
}
```

MobX's class approach is familiar, but it ties your model to a class hierarchy.
`makeAutoObservable` uses proxies under the hood — property access is implicitly
tracked, which is powerful but can be surprising when passing observables to
non-MobX code.

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

**MobX** — observable map with class instantiation:

```ts
const users = observable.map<string, UserModel>();

users.set(
  'alice',
  new UserModel({
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@co',
  }),
);

users.delete('alice');
users.has('bob');
```

MobX has `observable.map` and the class constructor can accept partial data, so
the per-entry API is similar. The difference is that MobX requires you to define
the class, its constructor, and `makeAutoObservable` call — ValUse's `createMap`
derives the collection API from the scope definition with no extra code.

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

**MobX** — `reaction()` or `autorun()`, set up separately:

```ts
class UserModel {
  lastUpdated = 0;

  constructor() {
    makeAutoObservable(this);
    // Must set up reaction per instance, outside the class or in constructor
    reaction(
      () => [this.firstName, this.lastName, this.email, this.role],
      action(() => {
        this.lastUpdated = Date.now();
      }),
    );
  }
}
```

The reaction callback must be wrapped in `action()` to avoid strict-mode
warnings. You must explicitly list tracked fields in the reaction expression, or
use `observe()` which fires per-field (no batching). Adding a field means
remembering to add it to the reaction list too.

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

**MobX** — automatic with `observer()`, but requires wrapping every component:

```tsx
const UserRow = observer(function UserRow({ id }: { id: string }) {
  const user = users.get(id)!;
  return (
    <input
      value={user.email}
      onChange={(e) => {
        user.email = e.target.value;
      }}
    />
  );
});
```

MobX's proxy tracking gives excellent per-row isolation — but only if you wrap
the component with `observer()`. Forget it and the component silently stops
reacting.

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

**MobX** — `flow()` for async, but abort and re-trigger are manual:

```ts
class UserModel {
  profile: unknown = null;
  profileLoading = false;
  profileError: unknown = null;
  private controller?: AbortController;

  constructor() {
    makeAutoObservable(this, { fetchProfile: flow });
    // Must manually trigger re-fetch when email changes
    reaction(
      () => this.email,
      (email) => this.fetchProfile(email),
    );
  }

  *fetchProfile(email: string) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.profileLoading = true;
    this.profileError = null;
    try {
      const res = yield fetch(`/api/users/${email}`, {
        signal: this.controller.signal,
      });
      this.profile = yield res.json();
      this.profileLoading = false;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.profileError = err;
        this.profileLoading = false;
      }
    }
  }
}
```

`flow()` uses generators for async, which is MobX-idiomatic but unfamiliar to
most developers. Abort logic, loading/error state, and the `reaction()` to
re-trigger are all manual.

---

## Sync reads async

Derive `avatarUrl` from the async `profile`.

**ValUse** — just another derivation. Sees `Profile | undefined`, never a
promise:

```ts
avatarUrl: ({ use }) => use('profile')?.avatar ?? '/default-avatar.png',
```

**MobX** — computed getter reads the observable, but you must handle the loading
state yourself:

```ts
get avatarUrl() {
  return (this.profile as any)?.avatar ?? '/default-avatar.png';
}
```

This works — MobX computeds can read any observable. But there's no type-safe
distinction between "not yet loaded" and "loaded with null." You're reading a
property that might not be populated yet, with no `AsyncState` to tell you why.

---

## Multiple independent instances

Two independent user tables, no shared state.

**ValUse:**

```ts
const tableA = user.createMap();
const tableB = user.createMap();
```

**MobX** — classes are already per-instance, but you need a collection wrapper:

```ts
class UserStore {
  users = observable.map<string, UserModel>();

  addUser(id: string, data?: UserData) {
    this.users.set(id, new UserModel(data));
  }
}

const storeA = new UserStore();
const storeB = new UserStore();
```

MobX classes are naturally multi-instance, but you end up building your own
collection class with factory logic — which is essentially what `createMap()`
does out of the box.

---

## Type safety

**ValUse** — string keys are fully type-checked:

```ts
getUser('email'); // string
getUser('displayName'); // string
getUser('emal'); // TS error — typo caught
setUser('displayName'); // TS error — it's derived, not settable
```

**MobX** — direct property access is fully typed:

```ts
user.email; // string
user.displayName; // string
user.emal; // TS error
user.displayName = 'x'; // TS error if using getter
```

MobX has excellent type safety via direct property access. This is one area
where MobX and ValUse are on equal footing. The tradeoff is that MobX requires
class definitions and `makeAutoObservable` to get there, while ValUse uses
string keys with inferred types from a plain object definition.

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

**MobX** — class inheritance with `makeObservable`:

```ts
import { makeObservable, observable, action } from 'mobx';

class Tracked {
  lastUpdated = 0;
  changeCount = 0;

  constructor() {
    // Each class must annotate its own properties
    makeObservable(this, {
      lastUpdated: observable,
      changeCount: observable,
      recordUpdate: action,
    });
  }

  recordUpdate() {
    this.lastUpdated = Date.now();
    this.changeCount++;
  }
}

class TrackedUser extends Tracked {
  name = '';
  email = '';

  constructor() {
    super();
    makeObservable(this, {
      name: observable,
      email: observable,
      setName: action,
    });
  }

  setName(name: string) {
    this.name = name;
    this.recordUpdate(); // must call manually in each setter
  }
}
```

MobX supports class inheritance, but `makeAutoObservable` — the convenient API —
cannot be used in both a base class and its subclass. You must fall back to
`makeObservable` with explicit annotations at every level. Each setter must
manually call `recordUpdate()` — there's no centralized "on any write" hook that
composes across the hierarchy.

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

**MobX** — constructor for init, `onBecomeObserved`/`onBecomeUnobserved` for
lazy activation, manual `dispose()` for cleanup:

```ts
import { makeAutoObservable, onBecomeObserved, onBecomeUnobserved } from 'mobx';

class ChatRoom {
  roomId: string;
  messages: Message[] = [];
  private ws?: WebSocket;
  private disposers: (() => void)[] = [];

  constructor(roomId: string) {
    this.roomId = roomId;
    makeAutoObservable(this, { ws: false, disposers: false });

    // "onInit" — constructor
    this.ws = new WebSocket(`/rooms/${roomId}`);
    this.ws.onmessage = (e) => this.messages.push(JSON.parse(e.data));

    // "onUsed" / "onUnused" — per property
    this.disposers.push(
      onBecomeObserved(this, 'messages', () => {
        this.ws?.send(JSON.stringify({ type: 'join' }));
      }),
      onBecomeUnobserved(this, 'messages', () => {
        this.ws?.send(JSON.stringify({ type: 'leave' }));
      }),
    );
  }

  // "onDestroy" — manual, caller must invoke
  dispose() {
    this.ws?.close();
    this.disposers.forEach((d) => d());
  }
}
```

MobX has genuine lazy activation support —
`onBecomeObserved`/`onBecomeUnobserved` fire when the first observer subscribes
and when the last detaches. However, there's no built-in `onDestroy` — you
implement a `dispose()` method and collect disposers manually. The caller must
remember to call it. The property names passed to `onBecomeObserved` are strings
with no compile-time check — a typo silently does nothing.

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

**MobX** — constructor injection of shared observables:

```ts
import { makeAutoObservable, observable } from 'mobx';

class TagRegistry {
  tags = observable.set<string>(['admin', 'root']);
  constructor() {
    makeAutoObservable(this);
  }
}

class Person {
  name = '';
  tags = observable.set<string>();

  constructor(private globalTags: TagRegistry) {
    makeAutoObservable(this);
  }

  get hasSpecialTag(): boolean {
    return [...this.tags].some((t) => this.globalTags.tags.has(t));
  }
}

const registry = new TagRegistry();
const alice = new Person(registry);
const bob = new Person(registry); // same registry
```

MobX handles shared state well — pass shared observables via constructor and
MobX's dependency tracking reacts automatically. `hasSpecialTag` re-derives when
either `this.tags` or `this.globalTags.tags` changes. The tradeoff is manual
wiring: you must pass shared instances through constructors or a root store.
There's no per-instance factory concept — if a `Board` needs its own `columns`
store, you instantiate it in the constructor and manage its lifetime yourself.

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

### MobX

```ts
import { makeAutoObservable, observable, reaction, flow, action } from 'mobx';

type UserData = {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
};

class UserModel {
  firstName = '';
  lastName = '';
  email = '';
  role = 'viewer';
  lastUpdated = 0;
  profile: unknown = null;
  profileLoading = false;
  profileError: unknown = null;
  private controller?: AbortController;

  constructor(data?: UserData) {
    makeAutoObservable(this, {
      fetchProfile: flow,
      controller: false,
    });
    if (data) Object.assign(this, data);

    reaction(
      () => [this.firstName, this.lastName, this.email, this.role],
      action(() => {
        this.lastUpdated = Date.now();
      }),
    );

    reaction(
      () => this.email,
      (email) => this.fetchProfile(email),
    );
  }

  get displayName() {
    return `${this.firstName} ${this.lastName}`;
  }

  get avatarUrl() {
    return (this.profile as any)?.avatar ?? '/default-avatar.png';
  }

  *fetchProfile(email: string) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.profileLoading = true;
    this.profileError = null;
    try {
      const res = yield fetch(`/api/users/${email}`, {
        signal: this.controller.signal,
      });
      this.profile = yield res.json();
      this.profileLoading = false;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.profileError = err;
        this.profileLoading = false;
      }
    }
  }
}

class UserStore {
  users = observable.map<string, UserModel>();

  constructor() {
    makeAutoObservable(this);
  }

  addUser(id: string, data?: UserData) {
    this.users.set(id, new UserModel(data));
  }

  removeUser(id: string) {
    this.users.delete(id);
  }
}

const store = new UserStore();
```

```tsx
import { observer } from 'mobx-react-lite';

const UserTable = observer(function UserTable() {
  const ids = Array.from(store.users.keys());
  return (
    <table>
      <tbody>
        {ids.map((id) => (
          <UserRow key={id} id={id} />
        ))}
      </tbody>
    </table>
  );
});

const UserRow = observer(function UserRow({ id }: { id: string }) {
  const user = store.users.get(id)!;

  return (
    <tr>
      <td>{user.displayName}</td>
      <td>
        <img src={user.avatarUrl} />
      </td>
      <td>
        <input
          value={user.email}
          onChange={(e) => {
            user.email = e.target.value;
          }}
        />
      </td>
      <td>{user.role}</td>
    </tr>
  );
});
```

Two classes, two `reaction()` setups, a generator-based `flow()` for async with
manual abort, and `observer()` on every component. MobX is powerful and the
property access is clean, but the ceremony adds up — especially around async and
lifecycle.
