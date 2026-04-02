# Quickstart

All code, minimal prose. See the [README](README.md) for full docs.

## Install

```bash
pnpm add valuse
```

## Standalone values

```ts
import { value, valueSet, valueMap } from 'valuse';

// Reactive primitives
const name = value<string>('Alice');
const count = value<number>(0);

name.get(); // 'Alice'
name.set('Bob');
name.set((prev) => prev.toUpperCase()); // callback form

// Subscribe outside React
const unsub = name.subscribe((v) => console.log(v));
unsub(); // stop listening

// Reactive Set
const tags = valueSet<string>(['admin', 'active']);
tags.has('admin'); // true
tags.add('editor');
tags.delete('admin');
tags.set((draft) => draft.add('editor')); // draft mutation

// Reactive Map
const scores = valueMap<string, number>([['alice', 95]]);
scores.get('alice'); // 95
scores.set((draft) => draft.set('bob', 82));
scores.delete('bob');
```

In React — `.use()` returns `[value, setter]`:

```tsx
const [currentName, setName] = name.use();
const [currentTags, setTags] = tags.use();
const [aliceScore, setAlice] = scores.use('alice'); // per-key subscription
const keys = scores.useKeys();
```

## Transforms and comparison

```ts
const trim = (v: string) => v.trim();
const lower = (v: string) => v.toLowerCase();

const email = value<string>('').pipe(trim).pipe(lower);

const user = value<User>({ id: 1, name: 'Alice' }).compareUsing(
  (a, b) => a.id === b.id, // skip update if same id
);
```

Works on all value types — `value`, `valueSet`, `valueMap`.

## Define a scope

```ts
import { value, valueScope } from 'valuse';

const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
  role: value<string>('viewer'),

  fullName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
});
```

## Create instances

```ts
const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });

bob.get('fullName'); // 'Bob Jones'
bob.set('role', 'admin');
bob.set('role', (prev) => prev.toUpperCase());
bob.set({ firstName: 'Robert', lastName: 'Smith' }); // bulk set
```

## Snapshots

```ts
bob.getSnapshot();
// { firstName: 'Bob', lastName: 'Jones', role: 'viewer', fullName: 'Bob Jones' }

bob.setSnapshot({ firstName: 'Alice' });
bob.get('lastName'); // undefined — full replacement, not merge
```

## Use in React

```tsx
import 'valuse/react'; // enable .use() hooks

function PersonCard() {
  // All fields — re-renders on any change
  const [getPerson, setPerson] = bob.use();

  return (
    <div>
      <h1>{getPerson('fullName')}</h1>
      <button onClick={() => setPerson('role', 'admin')}>Promote</button>
    </div>
  );
}

function FirstNameOnly() {
  // Single field — only re-renders when firstName changes
  const [firstName, setFirstName] = bob.use('firstName');

  return (
    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
  );
}

function FullNameDisplay() {
  // Derivation — read-only, no setter
  const [fullName] = bob.use('fullName');

  return <h2>{fullName}</h2>;
}
```

## Collections of scopes

```ts
const people = person.createMap();

people.set('alice', { firstName: 'Alice', lastName: 'Smith' });
people.set('bob', { firstName: 'Bob', lastName: 'Jones' });
people.delete('alice');
people.has('bob'); // true
people.keys(); // ['bob']
```

Hydrate from an API in one line:

```ts
const people = person.createMap(apiResponse, 'id');
```

In React — each row is its own reactive boundary:

```tsx
function PeopleTable() {
  const keys = people.useKeys();
  return keys.map((id) => <PersonRow key={id} id={id} />);
}

function PersonRow({ id }: { id: string }) {
  const [getPerson, setPerson] = people.use(id);
  return (
    <input
      value={getPerson('firstName')}
      onChange={(e) => setPerson('firstName', e.target.value)}
    />
  );
}
```

Per-field subscriptions work here too:

```ts
const [firstName, setFirstName] = people.use('bob', 'firstName');
const [fullName] = people.use('bob', 'fullName'); // derivation, read-only
```

## Plain values

Non-reactive data in scopes — readable via `get()`, invisible to derivations and
React:

```ts
import { value, valuePlain, valueScope } from 'valuse';

const settings = valueScope({
  name: value<string>(),
  config: valuePlain({ theme: 'dark' }, { readonly: true }),
  metadata: valuePlain({ createdBy: '' }),
});

const inst = settings.create();
inst.get('config'); // { theme: 'dark' }
inst.set('metadata', { createdBy: 'alice' }); // ok
inst.set('config', {}); // throws — readonly
inst.use('config'); // throws — not reactive
```

## Refs

Share reactive state across scopes without copying:

```ts
import { value, valueRef, valueScope } from 'valuse';

const address = valueScope({
  street: value<string>(),
  city: value('NYC'),
});
const sharedAddress = address.create({ street: '123 Main' });

const person = valueScope({
  name: value<string>(),
  address: valueRef(sharedAddress),
});
const bob = person.create({ name: 'Bob' });

bob.get('address').get('city'); // 'NYC'
bob.get('address').set('street', '456 Oak'); // mutates the shared instance
```

Per-instance refs with factories — each `create()` gets its own source:

```ts
const column = valueScope({ id: value<string>(), name: value<string>() });

const board = valueScope({
  columns: valueRef(() => column.createMap()),
  columnCount: ({ use }) => use('columns').size, // reacts to add/remove
});

const a = board.create();
const b = board.create();
// a and b each have their own independent column map
```

## Lifecycle hooks

```ts
const formField = valueScope(
  {
    value: value<string>(),
    initialValue: value<string>(),
    isDirty: ({ use }) => use('value') !== use('initialValue'),
  },
  {
    onInit: ({ set, get }) => {
      set('initialValue', get('value'));
    },
    // Prevent changes before they're written
    beforeChange: {
      value: ({ to, prevent }) => {
        if (to.length > 100) prevent(); // reject values over 100 chars
      },
    },
    // Catch-all form:
    // onChange: ({ changes, set }) => { ... },

    // Per-field form:
    onChange: {
      value: ({ from, to, set }) => {
        console.log(`value: ${from} → ${to}`);
      },
    },
    onUsed: ({ set, get }) => {
      // first subscriber attached — start polling, open socket, etc.
    },
    onUnused: ({ get }) => {
      // last subscriber detached — clean up
    },
    onDestroy: ({ get }) => {
      // instance removed — final cleanup
    },
  },
);
```

## Async derivations

An `async` derivation is reactive — it re-runs when its `use()` deps change,
aborts the previous run automatically, and tracks loading/error state:

```ts
const userProfile = valueScope({
  userId: value<string>(),

  // Fetches when userId changes. Previous fetch is aborted via signal.
  profile: async ({ use, signal }) => {
    const res = await fetch(`/api/users/${use('userId')}`, { signal });
    return res.json();
  },
});

const inst = userProfile.create({ userId: 'alice' });

// Read the value (undefined until resolved)
inst.get('profile'); // undefined, then { name: 'Alice', ... }

// Read the full async state
inst.getAsync('profile');
// { value: undefined, hasValue: false, status: 'setting', error: undefined }
// → { value: { name: 'Alice' }, hasValue: true, status: 'set', error: undefined }
```

Seed with cached data at creation — available immediately, replaced when the
fetch resolves:

```ts
const inst = userProfile.create({
  userId: 'alice',
  profile: cachedProfile, // becomes previousValue in first run
});
inst.get('profile'); // cachedProfile — no waiting
```

Push intermediate values with `set()` — for optimistic updates, streaming, or
polling:

```ts
const search = valueScope({
  query: value<string>(),

  results: async ({ use, set, signal }) => {
    const q = use('query');
    const cached = cache.get(q);
    if (cached) set(cached); // show cached immediately

    const res = await fetch(`/api/search?q=${q}`, { signal });
    return res.json(); // final value replaces cached
  },
});
```

In React — `useAsync()` gives you both the value and the loading state:

```tsx
function Profile() {
  const [profile, state] = inst.useAsync('profile');

  if (state.status === 'setting') return <Spinner />;
  if (state.status === 'error') return <Error error={state.error} />;
  return <div>{profile.name}</div>;
}
```

## Extend and compose

```ts
const trackedPerson = person.extend(
  { lastUpdated: value<number>(0) },
  {
    onChange: ({ set }) => {
      set('lastUpdated', Date.now());
    },
  },
);

// Middleware is just a function
const withSoftDelete = (scope) =>
  scope.extend({
    deleted: value<boolean>(false),
    deletedAt: value<number | null>(null),
  });

const fullPerson = withSoftDelete(trackedPerson);
```

## Batching

```ts
import { batch } from 'valuse';

batch(() => {
  name.set('Bob');
  count.set(42);
});
// Subscribers fire once, not twice
```

## Subscribe outside React

```ts
// Scope instance — all fields
bob.subscribe((get) => {
  console.log(get('fullName'));
});

// Single field — only fires when that field changes
bob.subscribe('firstName', (value, previousValue) => {
  console.log(`firstName: ${previousValue} → ${value}`);
});

// Scope map — fires when keys change
people.subscribe((keys) => {
  console.log('keys changed:', keys);
});

// Scope map — single field on one instance
people.subscribe('alice', 'email', (value, prev) => {
  console.log(`alice's email: ${prev} → ${value}`);
});

// Destroy — tear down all subscriptions at once
bob.destroy();
```
