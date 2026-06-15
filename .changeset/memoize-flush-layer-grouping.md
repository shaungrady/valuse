---
'valuse': patch
---

perf: memoize the `$flush()` layer grouping per scope template. The grouping
(which slots flush in which layer) is identical for every instance, but was
recomputed on every `create()` — allocating a `Map`, intermediate arrays, and
splitting every slot path. Caching it per definition roughly doubles instance
creation throughput.
