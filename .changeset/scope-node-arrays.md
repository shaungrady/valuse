---
'valuse': patch
---

perf: store a scope instance's node trees as dense arrays instead of Maps. The
slot→node and group→node lookups (`#scopeNodesBySlot` / `#scopeNodesByGroup`)
are always fully populated with contiguous integer keys, so they're now plain
arrays indexed by slot/group, dropping two `Map` headers and their hash-table
backings per instance. Internal only — no API or behavior change.
