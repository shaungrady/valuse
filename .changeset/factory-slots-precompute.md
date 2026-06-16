---
'valuse': patch
---

perf: precompute factory-pipe slot indices on the definition. The
`InstanceStore` constructor previously `.some()`-scanned every slot's pipeline
on each `create()` to find factory steps; it now iterates a precomputed
`factorySlots` list (built once per definition, like `derivedSlots` /
`asyncDerivedSlots`), so a factory-free scope skips the scan entirely. Internal
only — no API or behavior change.
