# Pipes

Pipes transform [values](reactive-values.md) on every `.set()` call before they
reach the signal. They are the primary mechanism for input normalization,
validation, and type conversion. Sync pipes are simple functions. Factory pipes
are stateful transforms like debounce and throttle.

## Table of contents

- [Sync pipes](#sync-pipes)
- [Type-changing pipes](#type-changing-pipes)
- [Chaining pipes](#chaining-pipes)
- [Factory pipes](#factory-pipes)
- [Built-in factory pipes](#built-in-factory-pipes)
- [Writing custom factory pipes](#writing-custom-factory-pipes)
- [Mixing sync and factory pipes](#mixing-sync-and-factory-pipes)
- [Pipeline ordering](#pipeline-ordering)
- [Pipes in scopes](#pipes-in-scopes)
- [Collection pipes](#collection-pipes)

---

## Sync pipes

A sync pipe is a function that receives a value and returns the transformed
result. Chain `.pipe()` to add one:

```ts
const email = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase());

email.set('  Alice@Example.Com  ');
email.get(); // 'alice@example.com'
```

Sync pipes run left to right on every `.set()` call. They are pure functions
with no side effects or timing concerns.

## Type-changing pipes

Pipes can change the output type. The _input_ type (what `.set()` accepts) stays
the same as the original `Value<In>`. The _output_ type (what `.get()` returns)
follows the last pipe:

```ts
const parsed = value<string>('0').pipe((v) => parseInt(v));
parsed.set('42'); // accepts string
parsed.get(); // returns number: 42
```

This is useful for separating the raw input format from the stored
representation:

```ts
const timestamp = value<string>('').pipe((v) => new Date(v));
timestamp.set('2024-01-15');
timestamp.get(); // Date object
```

Multiple type changes compose:

```ts
const flag = value<string>('')
  .pipe((v) => v.trim()) // string -> string
  .pipe((v) => v.length) // string -> number
  .pipe((v) => v > 0); // number -> boolean

flag.set('hello');
flag.get(); // true
flag.set('');
flag.get(); // false
```

The `.use()` React hook and `.subscribe()` callback both work with the output
type. The setter in `.use()` accepts the input type:

```tsx
const [isNonEmpty, setRaw] = flag.use();
// isNonEmpty: boolean
// setRaw: (value: string | (prev: string) => string) => void
```

## Chaining pipes

When a same-type pipe is added, `.pipe()` returns `this` for chaining. When the
type changes, it returns a new `Value` with the updated type:

```ts
// Same-type — returns this
const trimmed = value<string>('').pipe((v) => v.trim());

// Type-changing — returns new Value<string, number>
const counted = value<string>('').pipe((v) => v.length);
```

In practice, the distinction does not matter. You can chain freely:

```ts
const result = value<string>('')
  .pipe((v) => v.trim())
  .pipe((v) => v.toLowerCase())
  .pipe((v) => v.length)
  .compareUsing((a, b) => a === b);
```

## Factory pipes

For stateful, deferred transforms, `.pipe()` accepts a factory descriptor
instead of a plain function. A factory's `create` method is called once per
value instance and returns a writer function:

```ts
interface PipeFactoryDescriptor<In, Out> {
  create: (context: {
    set: (value: Out) => void;
    onCleanup: (fn: () => void) => void;
  }) => (value: In) => void;
}
```

The `set` function writes to the next stage of the pipeline (or to the signal if
this is the last step). The `onCleanup` function registers teardown logic that
runs when the value is destroyed.

The writer function receives each incoming value from `.set()` and decides when
(and whether) to call `set()`.

## Built-in factory pipes

ValUse ships several factory pipes:

### pipeDebounce

Delays the value by `ms` milliseconds. Resets the timer on each new value:

```ts
import { pipeDebounce } from 'valuse/utils';

const search = value('').pipe(pipeDebounce(300));
search.set('he');
search.set('hel');
search.set('hello');
// After 300ms of silence: search.get() === 'hello'
```

### pipeThrottle

Passes the first value immediately, then ignores subsequent values within the
`ms` window. The last value in a window is always emitted:

```ts
import { pipeThrottle } from 'valuse/utils';

const scroll = value(0).pipe(pipeThrottle(16));
// At most one update per 16ms (60fps)
```

### pipeBatch

Collects values and flushes the latest one on the next microtask:

```ts
import { pipeBatch } from 'valuse/utils';

const batched = value(0).pipe(pipeBatch());
batched.set(1);
batched.set(2);
batched.set(3);
// On next microtask: batched.get() === 3
```

### pipeFilter

Only passes values that match the predicate. Rejected values are silently
dropped:

```ts
import { pipeFilter } from 'valuse/utils';

const positive = value(0).pipe(pipeFilter((n) => n > 0));
positive.set(-5); // dropped
positive.set(3); // accepted
positive.get(); // 3
```

### pipeScan

Accumulates values over time, like `Array.reduce`. Each incoming value is
combined with the accumulator:

```ts
import { pipeScan } from 'valuse/utils';

const sum = value(0).pipe(pipeScan((acc, n) => acc + n, 0));
sum.set(3);
sum.get(); // 3
sum.set(7);
sum.get(); // 10
```

### pipeUnique

Only passes values that differ from the last emitted value. Uses strict equality
by default, or a custom comparator:

```ts
import { pipeUnique } from 'valuse/utils';

const unique = value('').pipe(pipeUnique());
unique.set('a'); // emitted
unique.set('a'); // skipped
unique.set('b'); // emitted

// With custom comparator
const uniqueUser = value<User>(defaultUser).pipe(
  pipeUnique((a, b) => a.id === b.id),
);
```

## Writing custom factory pipes

A factory pipe is an object with a `create` method. Here is a delay pipe that
waits a fixed time before passing through:

```ts
function pipeDelay<T>(ms: number): PipeFactoryDescriptor<T, T> {
  return {
    create: ({ set, onCleanup }) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      onCleanup(() => {
        if (timer !== null) clearTimeout(timer);
      });
      return (value: T) => {
        timer = setTimeout(() => {
          timer = null;
          set(value);
        }, ms);
      };
    },
  };
}

const delayed = value('').pipe(pipeDelay(500));
```

Key points:

- `create` runs once per value instance and returns the writer function
- The writer is called on every `.set()`
- Call `set()` to pass the value downstream
- Call `onCleanup()` to register teardown (timers, intervals, etc.)
- Not calling `set()` drops the value (like `pipeFilter`)

## Mixing sync and factory pipes

Sync and factory pipes can be mixed freely in a chain. They execute in order:

```ts
const search = value<string>('')
  .pipe((v) => v.trim()) // sync — immediate
  .pipe((v) => v.toLowerCase()) // sync — immediate
  .pipe(pipeDebounce(300)); // factory — delayed
```

When `.set(' Hello ')` is called:

1. `trim()` runs immediately: `'Hello'`
2. `toLowerCase()` runs immediately: `'hello'`
3. Debounce receives `'hello'` and starts a 300ms timer
4. After 300ms, the signal updates to `'hello'`

Sync steps before a factory pipe run immediately. Sync steps after a factory
pipe run when the factory calls `set()`. Multiple factory pipes chain through
each other.

## Pipeline ordering

The full pipeline for a value with pipes and a comparator:

1. **`.set(raw)`** — raw input enters
2. **Sync pipes** — transform left to right (up to the first factory)
3. **Factory pipe** — receives transformed input, calls `set()` when ready
4. **Remaining sync pipes** — run after the factory's `set()`
5. **`.compareUsing()`** — compared against current stored value
6. **Write** — if different, the signal updates and subscribers fire

Comparison always runs on the final, fully-transformed value.

## Pipes in scopes

Pipes defined on `value()` instances in a scope definition are preserved. Each
scope instance gets its own factory pipe state:

```ts
const form = valueScope({
  search: value('')
    .pipe((v) => v.trim())
    .pipe(pipeDebounce(300)),
  email: value('').pipe((v) => v.trim().toLowerCase()),
});

const a = form.create();
const b = form.create();
// a and b have independent debounce timers
```

The pipe definitions are part of the scope's metadata. The factory `create`
method runs once per instance per factory pipe. See
[Scopes](scopes.md#defining-a-scope) for the full list of definition entry
types.

## Collection pipes

`valueSet` and `valueMap` support `.pipe()` for whole-collection transforms:

```ts
const sorted = valueSet<string>().pipe((set) => {
  const arr = [...set].sort();
  return new Set(arr);
});
```

`valueArray` supports `.pipeElement()` for per-element transforms:

```ts
const names = valueArray<string>().pipeElement((s) => s.trim().toLowerCase());
names.push(' Hello ');
names.get(); // ['hello']
```

Collection pipes are sync-only. Factory pipes are not supported on collections.
