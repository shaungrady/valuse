---
'valuse': patch
---

perf: skip building the derivation `scope` tree for scopes that have no consumer
for it. Every `create()` previously built a second parallel tree of
`DerivationWrap` leaves (the restricted read-only `scope` passed to derivations,
async derivations, validate hooks, and ref resolution), even for plain
value-only scopes that never use it. Construction is now gated on the scope
actually having a sync/async derivation, a schema slot, a `validate` hook, or a
ref; otherwise a shared frozen placeholder is used. Cuts per-create allocation
(~5% faster `create()` for value-only scopes, and less GC pressure when creating
many — e.g. a large `ScopeMap`). No API or behavior change.
