---
'valuse': patch
---

perf: skip per-instance validation closures when a scope has nothing to
validate. Scopes with no `valueSchema` field, no `validate` hook, and no refs
(the common case) previously built ~14 per-instance closures for the validation
API. They now share a single set of instance-free method references, so the
validation surface costs nothing extra to allocate. Combined with the lazy
collection and node-array changes, a plain value-only scope's retained size is
roughly halved (~5.5 KB → ~2.7 KB). No API or behavior change.
