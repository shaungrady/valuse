---
'valuse': patch
---

perf: share one recompute epoch across an instance's sync derivations instead of
allocating a version signal per derived slot. Each scope instance now retains a
single epoch signal (allocated only when it has at least one sync derivation)
rather than one per derivation, trimming retained signals on derivation-heavy
scopes. Forcing a recompute on a single derived field (`field.recompute()`) now
also re-runs sibling sync derivations — a no-op write for any whose tracked
inputs are unchanged, per the pure-derivation contract. `$recompute()` and
per-field recompute semantics are otherwise unchanged.
