---
'valuse': patch
---

perf: defer two more per-instance allocations. The memoized snapshot `computed`
is now built on first `$getSnapshot`/`$use` instead of at `create()` time, so a
scope that's only written (never snapshotted) never allocates it. The
`_plainVersion` signal — only bumped by `valuePlain` writes — is now allocated
only when the scope actually has a plain slot, saving a signal per instance for
the common plain-free scope. No API or behavior change.
