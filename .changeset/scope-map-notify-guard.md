---
'valuse': patch
---

perf: skip the key-array allocation in `ScopeMap` notifications when nothing is
directly subscribed. Every `set`/`delete`/`clear` rebuilt the full key array to
pass to listeners; with no direct subscribers (the React bridge tracks a version
signal instead) that array was discarded. Building a keyed map via `createMap`
performs one `set` per item, so this made bulk construction O(n^2) in
allocation. Guarding on subscriber count makes it O(n) — building a 4k-entry map
is ~2x faster. No API or behavior change.
