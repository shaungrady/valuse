---
'valuse': patch
---

perf: precompute a per-definition snapshot plan in `buildSnapshot`. Field paths
were re-parsed (`includes`/`split`) on every snapshot rebuild; splitting each
path once per definition and reusing the plan across instances roughly doubles
snapshot rebuild throughput for nested scopes (and helps flat ones too). Affects
every change-then-read cycle (`$getSnapshot`, history, devtools, persistence).
