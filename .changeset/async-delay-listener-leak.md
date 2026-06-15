---
'valuse': patch
---

fix: stop `asyncDelay` from leaking abort listeners on the timeout path. The
`abort` listener was registered `{ once: true }`, so it only self-removed when
the signal actually fired — on the normal (delay-resolves) path it stayed
attached for the signal's lifetime. `asyncPoll` loops `asyncDelay` against one
long-lived signal, so listeners (and the heap they retained) accumulated
unbounded for the duration of the poll. The listener is now detached when the
delay resolves, keeping the live listener count at ~1 regardless of how many
delays a signal outlives.
