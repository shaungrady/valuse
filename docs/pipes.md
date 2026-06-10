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
- [Actor factory pipes](#actor-factory-pipes)
- [Switch pipes (createSwitchPipe)](#switch-pipes-createswitchpipe)
- [Writing custom factory pipes](#writing-custom-factory-pipes)
- [Flushing pipes](#flushing-pipes)
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
// Same-type; returns this
const trimmed = value<string>('').pipe((v) => v.trim());

// Type-changing; returns new Value<string, number>
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

For stateful, deferred transforms (debounce, throttle, batch), `.pipe()` accepts
a factory descriptor instead of a plain function. A factory's `create()` method
is called once per value instance with a `host`, and returns an **actor** that
handles each write. See [Actor factory pipes](#actor-factory-pipes) below for
the full shape; in short:

```ts
interface PipeFactoryDescriptor<In, Out> {
  create: (host: PipeHost<Out>) => PipeActor<In>;
}
```

The actor's `onWrite` receives each incoming value from `.set()`. The host gives
it `set()` to commit downstream, an abortable+flushable `host.deferBy(ms)`
helper for timers, `onCleanup` for teardown, and a `signal` that aborts when the
host value is destroyed. For the common cancel-and-replace case (debounce), the
[`createSwitchPipe`](#switch-pipes-createswitchpipe) helper hides the actor
boilerplate entirely.

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

## Actor factory pipes

A factory pipe's `create(host)` returns an **actor**; an object with an
`onWrite` method that handles each incoming write. The actor holds its own state
across writes (a throttle window, a batch buffer), so a new write does **not**
abort prior in-flight work. This is the key difference from async derivations,
which re-run wholesale on every dep change.

```ts
interface PipeHost<Out> {
  /** Commit a value downstream. */
  set(value: Out): void;
  /** Lifetime cleanup; fires when the host value is destroyed. */
  onCleanup(fn: () => void): void;
  /** Aborts when the host value is destroyed. */
  signal: AbortSignal;
  /**
   * Abortable + flushable sleep, governed by the host's destroy
   * signal. Host-tracked: each call registers with the host so the
   * actor's pending/flush behavior comes for free.
   */
  deferBy(ms: number): Promise<void>;
}

interface PipeActor<In> {
  /** Called once per upstream `.set()`. */
  onWrite(value: In): void;
  /** In-flight work, or null if idle. Optional; defaults to host-tracked deferBy. */
  pendingPromise?: Promise<void> | null;
  /** Expedite pending work. Optional; defaults to flushing host-tracked deferBy. */
  flush?(): void;
}

interface PipeFactoryDescriptor<In, Out = In> {
  create: (host: PipeHost<Out>) => PipeActor<In>;
}
```

An actor that only defers via `host.deferBy` needs to implement just `onWrite` —
`pendingPromise` and `flush` are derived by the host automatically.
`pipeThrottle` in full:

```ts
function pipeThrottle<T>(ms: number): PipeFactoryDescriptor<T, T> {
  return {
    create: (host) => {
      let inWindow = false;
      let trailing: { value: T } | null = null;
      return {
        onWrite(value) {
          if (inWindow) {
            trailing = { value };
            return;
          }
          host.set(value); // leading edge
          inWindow = true;
          void host.deferBy(ms).then(() => {
            if (trailing) {
              host.set(trailing.value); // trailing edge
              trailing = null;
            }
            inWindow = false;
          });
        },
      };
    },
  };
}
```

Override `pendingPromise` / `flush` only when the actor holds work the host
can't see; a raw `fetch`, an external promise.

## Switch pipes (createSwitchPipe)

The common cancel-and-replace pattern (debounce, or an async lookup embedded in
a pipe) is "switch" semantics: only the latest write's handler runs, and a new
write aborts the prior handler entirely. The `createSwitchPipe` helper captures
this, so you write only the handler:

```ts
import { createSwitchPipe } from 'valuse/utils';

function pipeDebounce<T>(ms: number): PipeFactoryDescriptor<T, T> {
  return createSwitchPipe(async ({ value, set, deferBy }) => {
    await deferBy(ms);
    set(value);
  });
}
```

The handler's `signal` aborts when a new write arrives, so any
`fetch(url, { signal })` after the `deferBy` is cancelled too, not just the
timer. The handler reads exactly like an async derivation because it shares the
same internal "switchable run" machinery.

```ts
interface SwitchContext<In, Out> {
  value: In;
  set: (value: Out) => void;
  deferBy: (ms: number) => Promise<void>;
  /** Aborts when a NEW write arrives OR the host is destroyed. */
  signal: AbortSignal;
  onCleanup: (fn: () => void) => void;
}
```

## Writing custom factory pipes

Most custom pipes fall into one of the two shapes above. A simple delay pipe is
cancel-and-replace, so use `createSwitchPipe`:

```ts
import { createSwitchPipe } from 'valuse/utils';

function pipeDelay<T>(ms: number): PipeFactoryDescriptor<T, T> {
  return createSwitchPipe(async ({ value, set, deferBy }) => {
    await deferBy(ms);
    set(value);
  });
}

const delayed = value('').pipe(pipeDelay(500));
```

Key points:

- **Cancel-and-replace** (debounce, delay, switch-to-latest) →
  `createSwitchPipe(handler)`. The handler's `signal` aborts on the next write;
  `deferBy` is inline.
- **Accumulating** (throttle, batch, scan over writes) → a plain actor via
  `create(host) => ({ onWrite })`. State lives in `create`'s closure;
  `host.deferBy` runs timers and is host-tracked.
- Call `set(value)` (switch) or `host.set(value)` (actor) to pass the value
  downstream. Not calling it drops the value (like `pipeFilter`).
- Use `onCleanup(fn)` to release resources (connections, subscriptions); in a
  switch handler it fires on the next write or destroy; on the host it fires on
  destroy.

## Flushing pipes

Every reactive field has a `.flush(): Promise<void>` method that cascades
through the pipe chain, expediting any in-flight `deferBy()` and awaiting
whatever other async work each pipe step holds (fetches, streaming uploads,
microtask batches, etc.):

```ts
const query = value<string>('').pipe(pipeDebounce(200));

query.set('hel'); // schedules a write in 200ms
query.set('hello'); // resets, write scheduled 200ms from now
await query.flush(); // commits 'hello' immediately, awaits the cascade
query.get(); // 'hello'
```

The Promise resolves once the signal reflects the latest write (the end of the
chain has been reached). For fire-and-forget callers (a keyboard handler bumping
flush on Enter), just call without awaiting. The Promise is harmlessly
unhandled.

**Cascading through chains.** A value with multiple async pipes is a
mini-pipeline: each pipe's downstream `set()` is the next pipe's upstream
`.set()`. `.flush()` follows the in-flight work step by step, expediting and
awaiting each one, until the signal settles.

```ts
const v = value<string>('')
  .pipe(pipeDebounce(200)) // step A
  .pipe(pipeUploadValidate()) // step B (fetch)
  .pipe(pipeBatch()); // step C (microtask)

v.set('hello');
await v.flush();
// Resolves after: A's deferBy expedites → B's fetch resolves →
// C's microtask runs → signal commits.
```

If a new `.set()` arrives mid-flush, it starts a fresh per-write run at step 0,
and the flush cascade picks it up. Flush effectively chases "until everything
settles"; a caller that keeps writing during flush keeps flush alive
indefinitely (by design).

`.flush()` is also available on derived fields and on whole scope instances via
`$flush()`. See
[Async Derivations](async-derivations.md#flushing-async-derivations) and
[Scopes](scopes.md#flushing-pending-work).

## Mixing sync and factory pipes

Sync and factory pipes can be mixed freely in a chain. They execute in order:

```ts
const search = value<string>('')
  .pipe((v) => v.trim()) // sync; immediate
  .pipe((v) => v.toLowerCase()) // sync; immediate
  .pipe(pipeDebounce(300)); // factory; delayed
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

1. **`.set(raw)`**: raw input enters.
2. **Sync pipes**: transform left to right (up to the first factory).
3. **Factory pipe**: receives transformed input, calls `set()` when ready.
4. **Remaining sync pipes**: run after the factory's `set()`.
5. **`.compareUsing()`**: compared against current stored value.
6. **Write**: if different, the signal updates and subscribers fire.

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
