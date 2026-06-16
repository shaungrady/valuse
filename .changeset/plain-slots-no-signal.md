---
'valuse': patch
---

perf: stop allocating a placeholder signal for `valuePlain` slots. Plain fields
are inert — read and written exclusively through a non-reactive backing map —
yet each one still reserved an unused `Signal` purely to keep the per-slot array
length-aligned. Plain slots now hold no signal (their array position is a hole),
saving roughly one signal (~88 bytes) of retained memory per plain field per
instance. Coarse trackers (`$subscribe`, the snapshot invalidator, `_trackAll`)
iterate a precomputed `trackableSlots` list so they skip inert plain fields
entirely. No API or behavior change.
