---
'valuse': patch
---

perf: share a single no-op pipe chain for factory-less values. `buildPipeChain`
previously allocated a fresh object (plus four closures and two intermediate
arrays) for every `Value` without a factory pipe — the overwhelmingly common
case. The factory-less path now scans without allocating and returns a frozen
shared no-op chain, cutting a standalone `Value`'s retained footprint by ~45%
(~960 B → ~510 B per instance, measured).
