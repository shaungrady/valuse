# Flush Pipeline — Deferred Work Cancellation and Expedited Commits

> **Status: In implementation.** Foundational layer-tracking on `ScopeTemplate`
> landed (see `src/__tests__/scope-layers.test.ts`). Public-API docs updated to
> describe the proposed shape; TDD test suite for `deferBy` / `.flush()` /
> `$flush()` lives at `src/__tests__/flush-pipeline.test.ts` and is currently
> skipped pending the runtime work in tasks #86–#89.

## Motivation

The canonical search-as-you-type interaction has three parts:

1. **Type into a search box.** The input updates immediately, the search itself
   is debounced.
2. **Hit Enter.** The pending debounce is cancelled and the search fires _now_
   with the current input.
3. **Press Esc / unfocus.** Pending work is dropped.

Today, valuse handles (1) and (3) cleanly (`pipeDebounce` for the debounce;
per-instance `onCleanup` for teardown). Path (2) — _flush_ — has no first-class
affordance:

- `pipeDebounce`'s timer is private closure state with no exposed handle.
- An in-derivation `await sleep(ms)` works for debounce-inside-async-deriv, but
  offers no way to be expedited from outside.
- Workarounds (a `submitTick` field, a manual debouncer in `onCreate`) leak
  implementation details into the scope and step outside the derivation graph.

The same shape recurs whenever deferred work meets a "do it now" event:

- Form blur flushing a debounced validator.
- Route change flushing pending persistence writes.
- Test setup waiting for all reactive work to settle deterministically.
- "Submit" buttons that need to guarantee no stale debounced inputs.

This proposal adds a uniform `.flush()` handle across pipes, async derivations,
and scope instances, anchored on a single deferral primitive (`deferBy(ms)`) for
asynchronous work.

## Public surface

### `deferBy(ms)` — the deferral primitive

`deferBy(ms)` returns a Promise that:

- Resolves after `ms` milliseconds.
- Rejects if the governing `signal` aborts (in a derivation: dep change or
  instance destroyed; in a switch pipe: a new write arrived or the host was
  destroyed; in a plain pipe actor: the host was destroyed).
- Resolves early if `.flush()` is called on the host field from outside.

It surfaces in three places, all with identical semantics:

- **Async derivation ctx** (`DerivCtx.deferBy`) — inline, governed by the run's
  signal. Derivations are inherently switch-shaped (a dep change aborts the
  prior run), so `deferBy` lives directly on the ctx.
- **Switch-pipe ctx** (via `createSwitchPipe`, below) — inline, governed by a
  per-write signal that aborts on the next write.
- **Pipe host** (`host.deferBy`, below) — for actor-style pipes that accumulate
  across writes; governed by the host's destroy signal, and host-tracked so the
  actor gets `pendingPromise`/`flush` for free.

```ts
results: async ({ scope, signal, deferBy }) => {
  const q = scope.query.use();
  if (q.length < 2) return [];

  await deferBy(200); // abortable + flushable

  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  return (await res.json()) as SearchResult[];
};
```

Multiple `deferBy()` calls in a single run are supported. Each call returns a
fresh deferral; only the currently-awaited one is affected by flush.

### Flushable pipes: the actor model

Unlike async derivations, pipes are **not** uniformly switch-shaped. A pipe
receives a stream of discrete writes, and some pipes combine them:
`pipeThrottle` holds a window across writes, `pipeBatch` buffers, `pipeScan`
reduces. A "new write aborts the prior run" rule (which is correct for
derivations) would destroy that accumulated state.

So a factory pipe is an **actor** with an explicit lifetime. The runtime hands
it a `host`; the actor decides its own scheduling:

```ts
interface PipeFactoryDescriptor<In, Out = In> {
  create: (host: PipeHost<Out>) => PipeActor<In>;
}

interface PipeHost<Out> {
  /** Commit a value downstream (chain continuation). */
  set(value: Out): void;
  /** Lifetime cleanup — fires when the host value is destroyed. */
  onCleanup(fn: () => void): void;
  /** Aborts when the host value is destroyed. */
  signal: AbortSignal;
  /**
   * Abortable + flushable sleep, governed by the host's destroy
   * signal. Host-tracked: every call registers with the host so the
   * actor's `pendingPromise` and `flush()` are derived automatically.
   * Does NOT auto-cancel on a new write — accumulating pipes rely on
   * the prior deferral surviving.
   */
  deferBy(ms: number): Promise<void>;
}

interface PipeActor<In> {
  /** Called once per upstream `.set()`. */
  onWrite(value: In): void;
  /**
   * In-flight work, or null if idle. OPTIONAL — defaults to the
   * host-tracked `deferBy` calls. Override only for work the host
   * can't see (a raw `fetch`, an external promise).
   */
  pendingPromise?: Promise<void> | null;
  /**
   * Expedite pending work. OPTIONAL — defaults to flushing the
   * host-tracked `deferBy` calls. Override for custom deferral.
   */
  flush?(): void;
}
```

The key design points:

- **No auto-abort.** A new `.set()` calls `onWrite` again; it does not cancel
  prior in-flight work. Accumulating pipes keep their window / buffer /
  accumulator intact.
- **Host-tracked `deferBy`.** Because `host.deferBy` registers each deferral
  with the host, an actor that only defers via the host needs to implement
  _only_ `onWrite` — `pendingPromise` and `flush` come for free. This removes
  the bookkeeping that made the raw actor clunky.
- **`pendingPromise` / `flush` are escape hatches** for actors holding work the
  host can't see (a raw `fetch`), or wanting custom flush behavior.

Sync pipes added via `.pipe((v) => transformed)` are unchanged — pure functions,
no factory, no deferral.

### Switch pipes: `createSwitchPipe`

The one pattern that genuinely wants cancel-and-replace — debounce, an async
search embedded in a pipe — is "switch" semantics: only the latest write's
handler runs to completion; a new write aborts the prior handler _entirely_
(including any `fetch` after a `deferBy`).

`createSwitchPipe` is a helper built on the actor model that captures this once:

```ts
function createSwitchPipe<In, Out>(
  handler: (ctx: SwitchContext<In, Out>) => void | Promise<void>,
): PipeFactoryDescriptor<In, Out>;

interface SwitchContext<In, Out> {
  value: In;
  set: (value: Out) => void;
  deferBy: (ms: number) => Promise<void>;
  /** Aborts when a NEW write arrives OR the host is destroyed. */
  signal: AbortSignal;
  onCleanup: (fn: () => void) => void;
}
```

Internally it owns the cancel-prior-on-write bookkeeping, tracks the current
handler run as `pendingPromise`, and wires `flush()` to expedite the active
`deferBy`. The handler reads exactly like an async derivation — because it
shares the same internal primitive (see
[Shared switchable-run primitive](#shared-switchable-run-primitive)).

### Derivations are switch-shaped; no actor model

Async derivations do **not** get the actor model. They have no stream of
discrete writes to accumulate — they re-run when a tracked dependency changes,
and the re-run aborts the prior run. That is switch semantics, always. There is
no accumulator scenario for a derivation:

- "Increment on each change" reads `previousValue` and returns `prior + 1` — a
  fresh run, not in-flight accumulation.
- "Collect into a list" is a `pipeScan` value or an array field with `onChange`,
  not a derivation.
- "Debounce the recompute" is `await deferBy(ms)` at the top of the run.

So derivations keep their existing run model and gain exactly two things:
`deferBy` on the ctx, and `.flush()` that expedites the active `deferBy` and
awaits the run.

### Shared switchable-run primitive

`createSwitchPipe` and the async-derivation run are the _same_ shape: abort the
prior run, start a fresh one, track the current run's `deferBy`, expose `flush`.
Both are implemented over one internal primitive — call it a **switchable async
run**. Derivations define it (they're inherently switch-shaped);
`createSwitchPipe` reuses it for the pipe subset that wants it. The actor model
does not touch derivations; the dependency flows the other way.

### `.flush()` on every field

Every reactive field gets an always-present `.flush(): Promise<void>` method:

- `FieldValue<In, Out>` — cascades through every pipe step's in-flight per-write
  run (see [Pipe chain cascade](#pipe-chain-cascade)).
- `FieldValueArray<T>`, `FieldValueSet<T>`, `FieldValueMap<K, V>` — same, for
  `pipeElement`-style chains.
- `FieldValueSchema<In, Out>` — same.
- `FieldDerived<T>` (sync) — Promise resolves immediately. Sync derivations have
  no deferred state.
- `FieldAsyncDerived<T>` — resolves any in-flight `deferBy()` immediately,
  returns Promise that resolves when the current run completes.

**Return type is uniformly `Promise<void>`** because any pipe or derivation may
hold arbitrary async work (a `fetch`, a streaming upload, anything
`await`-able), not just `deferBy()`. A caller that needs a settle signal can
`await field.flush()`; fire-and-forget callers (a `keydown` handler bumping
flush on Enter) just call it and ignore the Promise.

**Why always-present and not conditional?** Conditional typing requires
detecting whether a pipe chain contains a flushable step (or whether an async
derivation calls `deferBy`). The former leaks complexity into every pipe
factory's type; the latter is impossible without inspecting the function body.
The runtime no-op (resolved-immediately Promise) is semantically correct and
uniform-typing is friendlier to generic helpers.

#### Pipe chain cascade

A value can chain multiple factory pipes (actors). Each actor's downstream
`host.set(value)` is upstream `.set(value)` to the next actor's `onWrite`. So
work can be in flight at multiple stages of the chain simultaneously.

`.flush()` follows the in-flight work all the way to the signal via a sequential
chase over the actors:

```ts
async flush() {
  while (true) {
    const pending = actors.find((a) => a.pendingPromise);
    if (!pending) return; // chain is idle, signal is settled
    pending.flush?.(); // expedite this actor's deferrals (no-op if none)
    await pending.pendingPromise;
    // Awaiting resolves once this actor called host.set() downstream,
    // which may have started the next actor's work. Loop catches it.
  }
}
```

Each iteration handles one actor at a time: expedite its deferrals, await its
pending work to complete (which propagates downstream), loop. The cascade exits
when no actor is in flight, meaning the committed signal value reflects the
latest write.

If a new `.set()` arrives mid-flush, it re-enters at actor 0. The next loop
iteration picks it up. Flush effectively chases "until everything settles." A
caller that keeps writing during flush keeps flush alive indefinitely — by
design.

### `$flush()` on scope instances

Every scope instance gets an async `$flush(): Promise<void>` method that walks
the scope's layers in dependency order. Since every field/derivation `.flush()`
returns a Promise, the cascade is a clean `await Promise.all` per layer:

```ts
async $flush(): Promise<void> {
  // 1. Flush every field-layer entry (commits pipe chains, awaits the
  //    full cascade through each chain). Run them in parallel — fields
  //    don't depend on each other.
  await Promise.all(fieldLayer.map((entry) => entry.flush()));

  // 2. For each derivation layer in declaration order: flush all entries
  //    in parallel, then await the layer to settle before moving on, so
  //    layer N+1 sees the resolved values from layer N rather than
  //    mid-flight intermediates.
  for (const layer of derivLayers) {
    await Promise.all(layer.map((entry) => entry.flush()));
  }
}
```

The cascade must be in dependency order. Firing all flushes simultaneously is
broken: an async deriv that's mid-init won't have hit its `deferBy` yet, the
flush signal arrives as a no-op, and the deriv then waits the full duration.

Use cases:

- **Form submit**: `await form.$flush(); submit(form.$getSnapshot())`.
- **Persistence**: `await scope.$flush(); save(scope.$getSnapshot())`.
- **Tests**: deterministic settle without `vi.advanceTimersByTime()`.

## Layer-boundary preservation

For `$flush()` to cascade in dependency order, the runtime must know the
declared layer structure. Currently `ScopeTemplate` flattens every layer literal
into a single `#rawDefinition` via `deepMergeLayers`
(`src/core/value-scope.ts:370`) and discards the boundaries.

**Change**: alongside `#rawDefinition`, track:

```ts
readonly #layers: ReadonlyArray<Record<string, unknown>>;
```

Each entry is one layer literal as it was passed to `valueScope()` or
`extendValues()`. The array is append-only across extensions:

- `valueScope(fields, ...derivs, config?)` → `#layers = [fields, ...derivs]`
  (config doesn't participate in flush ordering).
- `template.extendValues(L1, ...Ln)` →
  `#layers = [...template.#layers, L1, ...Ln]`.

This gives `$flush()` a direct iteration order and opens incidental wins:

- Devtools can show declared layer boundaries.
- `$recompute()` could go layer-by-layer instead of one flat pass.
- Future debugging surfaces can introspect the declared structure.

Layers from extensions append after the base's layers, which matches the
dependency direction — extension derivations can see all base derivations and
the merged fields, but base derivations cannot see extension fields.

## Author experience

### Rebuilding `pipeDebounce` (switch pipe)

Debounce is cancel-and-replace, so it uses `createSwitchPipe`. The handler reads
identically to a search async derivation:

```ts
export function pipeDebounce<T>(ms: number): PipeFactoryDescriptor<T, T> {
  return createSwitchPipe(async ({ value, set, deferBy }) => {
    await deferBy(ms);
    set(value);
  });
}
```

Compare to the async-derivation version of the same idea:

```ts
results: async ({ scope, signal, deferBy }) => {
  const q = scope.query.use();
  await deferBy(200);
  // ...fetch
};
```

Same primitive, same mental model (they share the switchable-run machinery). A
`.flush()` on the field resolves the `deferBy()`; a new `.set()` aborts the
prior handler.

### Rebuilding `pipeThrottle` (accumulating actor)

Throttle accumulates a window across writes, so it's a plain actor — no
`createSwitchPipe`. Cross-call state lives in `create()`'s closure;
`host.deferBy` runs the window timer and is host-tracked, so the actor needs no
`pendingPromise`/`flush` of its own:

```ts
export function pipeThrottle<T>(ms: number): PipeFactoryDescriptor<T, T> {
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
        // no pendingPromise, no flush — host derives them from deferBy
      };
    },
  };
}
```

`.flush()` on the host field resolves the tracked `deferBy(ms)` early, which
runs the trailing-edge commit and closes the window immediately.

### Rebuilding `pipeBatch` (accumulating actor)

Batch buffers writes and flushes on the next microtask — also a plain actor:

```ts
export function pipeBatch<T>(): PipeFactoryDescriptor<T, T> {
  return {
    create: (host) => {
      let pending: { value: T } | null = null;
      let scheduled = false;
      return {
        onWrite(value) {
          pending = { value };
          if (scheduled) return; // already have a microtask queued
          scheduled = true;
          void host.deferBy(0).then(() => {
            scheduled = false;
            if (pending) {
              host.set(pending.value);
              pending = null;
            }
          });
        },
      };
    },
  };
}
```

## Naming

- `deferBy(ms)` over `defer(ms)`, `settle(ms)`, `sleep(ms)`, `delay(ms)`: the
  explicit "by" clarifies units, and `settle` collides with promise terminology
  (a "settled promise" means fulfilled-or-rejected).
- `.flush()` over `.commit()`, `.now()`, `.force()`: matches Lodash's precedent
  (`_.debounce` exposes `.flush()`) and accurately describes the semantic
  (expedite pending work, don't replace it).
- `$flush()` follows the existing instance-method `$`-prefix convention.

## Open questions

1. **Should `.flush()` chain across `valueRef` boundaries?** Probably yes when
   `$flush()` traverses the scope tree, but not when a single field's `.flush()`
   is called. The scope-level cascade is recursive; field-level is local.

2. **Should `recompute()` and `.flush()` interact?** If a derivation is sitting
   on `deferBy(200)` and you call `.recompute()`, the current run is aborted and
   a fresh run starts. The fresh run hits a fresh `deferBy(200)`. That's correct
   — recompute is "restart from scratch," not "expedite current run." `.flush()`
   after `.recompute()` would expedite the _new_ run's deferBy.

3. **Sync-derivation flush behavior**. Currently proposed as a no-op.
   Alternative: treat it as a sync `recompute()`. Probably no-op is right — sync
   derivations don't _have_ deferred state, so there's nothing to "flush." A
   separate `recompute()` is the right tool for "re-run me now."

4. **Layer-merge semantics for extension layers**. Today `extendValues`
   deep-merges every arg into a single flat definition. Under this proposal,
   each arg becomes its own layer entry. Does merging across _layer index_ still
   make sense? For example, if base has 3 derivation layers and an extension
   passes 2 derivation layers, does `extLayer[0]` merge with `baseLayer[1]`
   (matching index after the field layer), or does it become a new layer
   downstream of _all_ base derivations? Recommend the latter: extension layers
   always append. The "merge with index" interpretation conflicts with the
   declared dependency direction (extensions depend on the base, not vice
   versa).

## Test plan

- `createDeferBy` primitive: resolves after `ms`, rejects on signal abort,
  resolves early on `flush()`, idempotent flush/cancel.
- `host.deferBy` in actor pipes: resolves after `ms`, aborts when the host is
  destroyed, resolves early on host `.flush()`, host-tracked in
  `pendingPromise`.
- `createSwitchPipe`: a new write aborts the prior handler's `signal` (including
  a `fetch` after a `deferBy`), only the latest handler commits, `flush()`
  expedites the active `deferBy`.
- `deferBy(ms)` in async derivations: resolves after `ms`, aborts on dep change,
  aborts on destroy, resolves early on `.flush()`.
- `pipeDebounce` (switch): rapid `.set()` calls produce one committed value (the
  last); `.flush()` commits immediately.
- `pipeThrottle` / `pipeBatch` (actors): accumulation survives across writes
  (the bug a naive auto-abort model would cause); `.flush()` runs the
  trailing/buffered commit.
- `.flush()` on values that lack flushable pipes: resolves immediately, no
  error.
- Pipe-chain cascade: a 2+ async-pipe chain flushes end-to-end; the committed
  signal reflects the latest write.
- `$flush()` cascade: layer 0 (field flushes), layer 1 (async deriv resolves),
  layer 2 (async deriv depending on layer 1 sees the resolved value, not
  undefined).
- `$flush()` returns a Promise that resolves only after the full cascade has
  settled.
- Extension layers append correctly: base + extension `$flush()` visits base
  layers first, then extension layers.
- React integration: `.flush()` from a `onKeyDown` handler does not cause
  spurious re-renders beyond the expected single recompute.

## Migration impact

The library hasn't shipped a stable release, so this proposal is a breaking
change without backward-compat shims:

- **`PipeFactoryDescriptor.create()`** changes shape: now takes a `host` and
  returns a `PipeActor` (`{ onWrite, pendingPromise?, flush? }`) instead of a
  sync `(value) => void`. The three shipped factory pipes (`pipeDebounce`,
  `pipeThrottle`, `pipeBatch`) and any third-party factories must be rewritten —
  `pipeDebounce` via `createSwitchPipe`, the accumulating ones as plain actors.
- **Sync pipes** (`.pipe((v) => transformed)`) are unaffected.
- **`.flush()` and `$flush()`** are new additions, no migration needed.
- **`deferBy()`** is new: inline on `DerivCtx` and `SwitchContext`, and as
  `host.deferBy` on `PipeHost`. `createSwitchPipe` is a new export from
  `valuse/utils`. The underlying `createDeferral` primitive
  (`src/core/utils/deferral.ts`) is internal — `deferBy` always surfaces through
  a ctx or the host, never constructed directly by users.

## Out of scope

- A read-side debounced projection (e.g., `value(...).useSettled()`) is _not_
  part of this proposal. The motivating search example uses in-derivation
  `deferBy` rather than pipe-debounce on the input field, side-stepping the
  input-lag problem entirely.
- Throttling/debouncing of sync derivations. Sync derivations are intentionally
  instantaneous; if you need deferral, use an async derivation.
