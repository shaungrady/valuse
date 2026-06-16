# valuse

## 0.3.2

### Patch Changes

- 082bca7: perf: precompute factory-pipe slot indices on the definition. The
  `InstanceStore` constructor previously `.some()`-scanned every slot's pipeline
  on each `create()` to find factory steps; it now iterates a precomputed
  `factorySlots` list (built once per definition, like `derivedSlots` /
  `asyncDerivedSlots`), so a factory-free scope skips the scan entirely.
  Internal only — no API or behavior change.
- e9858cc: perf: skip building the derivation `scope` tree for scopes that have
  no consumer for it. Every `create()` previously built a second parallel tree
  of `DerivationWrap` leaves (the restricted read-only `scope` passed to
  derivations, async derivations, validate hooks, and ref resolution), even for
  plain value-only scopes that never use it. Construction is now gated on the
  scope actually having a sync/async derivation, a schema slot, a `validate`
  hook, or a ref; otherwise a shared frozen placeholder is used. Cuts per-create
  allocation (~5% faster `create()` for value-only scopes, and less GC pressure
  when creating many — e.g. a large `ScopeMap`). No API or behavior change.
- 6d3233c: perf: stop allocating a placeholder signal for `valuePlain` slots.
  Plain fields are inert — read and written exclusively through a non-reactive
  backing map — yet each one still reserved an unused `Signal` purely to keep
  the per-slot array length-aligned. Plain slots now hold no signal (their array
  position is a hole), saving roughly one signal (~88 bytes) of retained memory
  per plain field per instance. Coarse trackers (`$subscribe`, the snapshot
  invalidator, `_trackAll`) iterate a precomputed `trackableSlots` list so they
  skip inert plain fields entirely. No API or behavior change.
- a000297: perf: skip the key-array allocation in `ScopeMap` notifications when
  nothing is directly subscribed. Every `set`/`delete`/`clear` rebuilt the full
  key array to pass to listeners; with no direct subscribers (the React bridge
  tracks a version signal instead) that array was discarded. Building a keyed
  map via `createMap` performs one `set` per item, so this made bulk
  construction O(n^2) in allocation. Guarding on subscriber count makes it O(n)
  — building a 4k-entry map is ~2x faster. No API or behavior change.
- aa757e7: perf: share one recompute epoch across an instance's sync derivations
  instead of allocating a version signal per derived slot. Each scope instance
  now retains a single epoch signal (allocated only when it has at least one
  sync derivation) rather than one per derivation, trimming retained signals on
  derivation-heavy scopes. Forcing a recompute on a single derived field
  (`field.recompute()`) now also re-runs sibling sync derivations — a no-op
  write for any whose tracked inputs are unchanged, per the pure-derivation
  contract. `$recompute()` and per-field recompute semantics are otherwise
  unchanged.

## 0.3.1

### Patch Changes

- 62d1772: fix: stop `asyncDelay` from leaking abort listeners on the timeout
  path. The `abort` listener was registered `{ once: true }`, so it only
  self-removed when the signal actually fired — on the normal (delay-resolves)
  path it stayed attached for the signal's lifetime. `asyncPoll` loops
  `asyncDelay` against one long-lived signal, so listeners (and the heap they
  retained) accumulated unbounded for the duration of the poll. The listener is
  now detached when the delay resolves, keeping the live listener count at ~1
  regardless of how many delays a signal outlives.
- 9786e3b: fix: correct `valueMap` draft `delete` semantics for keys that were
  only set within the same draft. Deleting a pending (not-yet-committed) key no
  longer records a stale tombstone, so `draft.size` stays accurate and a second
  `delete` of an already-deleted key now returns `false`, matching native `Map`.
- 3b934e0: perf: allocate `InstanceStore`'s per-slot collections lazily. Heap
  snapshots showed ~45% of a scope instance was `Map`/`Set` backing tables — 11
  Maps + 1 Set per instance, ~6 of them empty for a typical value-only scope.
  The async-state, validation-state, factory-pipe-chain, plain-value, recompute,
  and flush collections (plus the `runningAsync` set and the change-bubbling
  reverse map) are now created only when the scope actually has the
  corresponding slot kind or a change hook fires. A plain 2-field scope drops
  from ~5.5 KB to ~4.1 KB retained (~26%); Maps per instance fall from 11 to 4.
  No public API or behavior change.
- b859575: perf: defer two more per-instance allocations. The memoized snapshot
  `computed` is now built on first `$getSnapshot`/`$use` instead of at
  `create()` time, so a scope that's only written (never snapshotted) never
  allocates it. The `_plainVersion` signal — only bumped by `valuePlain` writes
  — is now allocated only when the scope actually has a plain slot, saving a
  signal per instance for the common plain-free scope. No API or behavior
  change.
- 3784be6: perf: rebuild scope snapshots lazily. The memoized snapshot was kept
  fresh by an eager effect that re-read every slot on every write — so each
  field write paid a full snapshot-invalidation pass even when nothing ever read
  the snapshot. Replace it with a lazy `computed` that rebuilds only on the next
  read after a change, reading each slot once (tracked) to both produce the
  value and register the dependency. Field writes that don't read a snapshot are
  ~2x faster; snapshot-read paths (`$getSnapshot`, `$use`, history/persistence/
  devtools) are also modestly faster.
- 58936f9: perf: memoize the `$flush()` layer grouping per scope template. The
  grouping (which slots flush in which layer) is identical for every instance,
  but was recomputed on every `create()` — allocating a `Map`, intermediate
  arrays, and splitting every slot path. Caching it per definition roughly
  doubles instance creation throughput.
- 5cc0ec2: perf: precompute a per-definition snapshot plan in `buildSnapshot`.
  Field paths were re-parsed (`includes`/`split`) on every snapshot rebuild;
  splitting each path once per definition and reusing the plan across instances
  roughly doubles snapshot rebuild throughput for nested scopes (and helps flat
  ones too). Affects every change-then-read cycle (`$getSnapshot`, history,
  devtools, persistence).
- 211c9bf: perf: share a single no-op pipe chain for factory-less values.
  `buildPipeChain` previously allocated a fresh object (plus four closures and
  two intermediate arrays) for every `Value` without a factory pipe — the
  overwhelmingly common case. The factory-less path now scans without allocating
  and returns a frozen shared no-op chain, cutting a standalone `Value`'s
  retained footprint by ~45% (~960 B → ~510 B per instance, measured).
- 72274a0: perf: store a scope instance's node trees as dense arrays instead of
  Maps. The slot→node and group→node lookups (`#scopeNodesBySlot` /
  `#scopeNodesByGroup`) are always fully populated with contiguous integer keys,
  so they're now plain arrays indexed by slot/group, dropping two `Map` headers
  and their hash-table backings per instance. Internal only — no API or behavior
  change.
- 3491927: perf: skip per-instance validation closures when a scope has nothing
  to validate. Scopes with no `valueSchema` field, no `validate` hook, and no
  refs (the common case) previously built ~14 per-instance closures for the
  validation API. They now share a single set of instance-free method
  references, so the validation surface costs nothing extra to allocate.
  Combined with the lazy collection and node-array changes, a plain value-only
  scope's retained size is roughly halved (~5.5 KB → ~2.7 KB). No API or
  behavior change.

## 0.3.0

### Minor Changes

- f5b9229: `scope.<mapRef>.use()` inside a derivation now tracks every member's
  fields, not just the key list. A derivation that reads into a referenced
  `ScopeMap`'s entries (sorting, aggregating, filtering) re-runs when any member
  field changes, matching how an instance ref already tracks all of a referenced
  instance's fields. Both sync and async derivations are covered. Use `.get()`
  instead of `.use()` for an untracked read.

### Patch Changes

- 042c65e: Harden the `sessionStorage` adapter against environments where
  storage access throws, and speed up scope instance creation and snapshot
  reads.

## 0.2.0

### Minor Changes

- 90125fc: Release-readiness hardening: bug fixes, a new export, and a slimmer
  package.
  - **Fix** `asyncTimeout` so it rejects when the deadline elapses instead of
    waiting for `fn` to settle first.
  - **Fix** `createSwitchPipe` to drop commits from a superseded handler, so
    stale async results can no longer overwrite newer ones.
  - **Fix** `withPersistence` to not clobber a user write that lands while an
    async adapter (e.g. IndexedDB) is still hydrating.
  - **Fix** a transitive subscription leak: destroying a scope while it still
    has a subscriber now releases its referenced children.
  - **Fix** `asyncRetry` to throw a clear `RangeError` when `max < 1` instead of
    rejecting with `undefined`.
  - **Fix** `$setSnapshot` to ignore non-object input (warn and skip) instead of
    throwing a cryptic error.
  - **Fix** the `localStorage` adapter to return `null` instead of throwing when
    accessing storage is blocked (Safari private mode, sandboxed iframes).
  - **Add** `PipeHost` and `PipeActor` to the public exports for authoring
    factory pipes.
  - **Smaller package:** source maps are no longer published (~730kB → ~290kB).
