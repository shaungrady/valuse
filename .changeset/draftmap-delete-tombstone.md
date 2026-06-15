---
'valuse': patch
---

fix: correct `valueMap` draft `delete` semantics for keys that were only set
within the same draft. Deleting a pending (not-yet-committed) key no longer
records a stale tombstone, so `draft.size` stays accurate and a second `delete`
of an already-deleted key now returns `false`, matching native `Map`.
