---
'valuse': minor
---

`scope.<mapRef>.use()` inside a derivation now tracks every member's fields, not
just the key list. A derivation that reads into a referenced `ScopeMap`'s
entries (sorting, aggregating, filtering) re-runs when any member field changes,
matching how an instance ref already tracks all of a referenced instance's
fields. Both sync and async derivations are covered. Use `.get()` instead of
`.use()` for an untracked read.
