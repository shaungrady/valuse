# valuse

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
