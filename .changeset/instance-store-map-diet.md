---
'valuse': patch
---

perf: allocate `InstanceStore`'s per-slot collections lazily. Heap snapshots
showed ~45% of a scope instance was `Map`/`Set` backing tables — 11 Maps + 1 Set
per instance, ~6 of them empty for a typical value-only scope. The async-state,
validation-state, factory-pipe-chain, plain-value, recompute, and flush
collections (plus the `runningAsync` set and the change-bubbling reverse map)
are now created only when the scope actually has the corresponding slot kind or
a change hook fires. A plain 2-field scope drops from ~5.5 KB to ~4.1 KB
retained (~26%); Maps per instance fall from 11 to 4. No public API or behavior
change.
