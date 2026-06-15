---
'valuse': patch
---

perf: rebuild scope snapshots lazily. The memoized snapshot was kept fresh by an
eager effect that re-read every slot on every write — so each field write paid a
full snapshot-invalidation pass even when nothing ever read the snapshot.
Replace it with a lazy `computed` that rebuilds only on the next read after a
change, reading each slot once (tracked) to both produce the value and register
the dependency. Field writes that don't read a snapshot are ~2x faster;
snapshot-read paths (`$getSnapshot`, `$use`, history/persistence/ devtools) are
also modestly faster.
