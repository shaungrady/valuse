# Undo & Redo

`withHistory` adds an undo/redo stack to a scope. It tracks snapshots of value
fields, exposes `$undo()`, `$redo()`, `$canUndo`, `$canRedo`, and
`$clearHistory()` on every instance, and keeps memory bounded with a ring
buffer.

```ts
import { valueScope, value } from 'valuse';
import { withHistory } from 'valuse/middleware';

const draftScope = withHistory(
  valueScope({
    to: value<string>(''),
    subject: value<string>(''),
    body: value<string>(''),
  }),
  { maxDepth: 100, batchMs: 300 },
);

const draft = draftScope.create({ to: '', subject: '', body: '' });
draft.subject.set('Hello');
draft.subject.set('Hello, world');

draft.$canUndo; // true
draft.$undo(); // subject: 'Hello'
draft.$undo(); // subject: ''
draft.$redo(); // subject: 'Hello'
```

## Table of contents

- [Options](#options)
- [Instance extensions](#instance-extensions)
- [Reactive $canUndo / $canRedo](#reactive-canundo--canredo)
- [Recording is synchronous](#recording-is-synchronous)
- [Batched changes](#batched-changes)
- [Forking the redo stack](#forking-the-redo-stack)
- [Bounded depth](#bounded-depth)
- [Tracking a subset of fields](#tracking-a-subset-of-fields)
- [Undo/redo and other hooks](#undoredo-and-other-hooks)

---

## Options

```ts
interface HistoryOptions {
  /**
   * Maximum number of history entries. Default: 50.
   * When the limit is reached, oldest entries are dropped.
   */
  maxDepth?: number;

  /**
   * Which fields to track. Default: all fields in the snapshot.
   * Derivations are typically omitted since they recompute from tracked state.
   */
  fields?: string[];

  /**
   * Merge rapid changes within this window (ms) into a single entry.
   * Default: 0 (every change is a separate entry).
   */
  batchMs?: number;
}
```

## Instance extensions

Each instance returned by the wrapped template has, in addition to the standard
`ScopeInstance` API:

```ts
interface HistoryInstance {
  $undo: () => void;
  $redo: () => void;
  readonly $canUndo: boolean;
  readonly $canRedo: boolean;
  $clearHistory: () => void;
}
```

- `$undo()` and `$redo()` restore a previous/next snapshot in one atomic
  `$setSnapshot` call. Derivations recompute naturally.
- `$canUndo` and `$canRedo` are backed by signals. Read them in a derivation and
  the derivation re-runs when availability changes.
- `$clearHistory()` drops the stack back to the current state. `$canUndo`
  becomes `false` immediately.

## Reactive $canUndo / $canRedo

Because `$canUndo` / `$canRedo` are signal-backed getters, you can wire them
into React components via `$use()`. `$use()` subscribes to any field change on
the instance, so the component re-renders whenever a field changes, and the
getter reflects the latest history state:

```tsx
function UndoButton({ draft }) {
  draft.$use(); // subscribe to any change so $canUndo stays current
  return (
    <button disabled={!draft.$canUndo} onClick={draft.$undo}>
      Undo
    </button>
  );
}
```

`$canUndo` / `$canRedo` are instance-level properties, not scope fields, so they
are not accessible inside derivations (derivations see the field tree, not the
instance). Read them in React components or lifecycle hooks instead.

## Recording is synchronous

Unlike `onChange` (which batches on a microtask), history recording is
synchronous. You can call `$undo()` immediately after `.set()`:

```ts
draft.subject.set('A');
draft.subject.set('B');
draft.$undo(); // 'A', without awaiting a microtask
```

This is deliberate; undo in a typing context needs to feel instant. The
middleware uses `$subscribe` (backed by a Preact signals `effect`) rather than
`onChange` so each set produces a synchronous snapshot.

## Batched changes

`batchMs` merges rapid changes into a single history entry. Typing "hello" into
an input produces five sets, but only one undo-step should be needed to clear
the word:

```ts
const draftScope = withHistory(scope, { batchMs: 300 });

draft.body.set('h');
draft.body.set('he');
draft.body.set('hel');
draft.body.set('hell');
draft.body.set('hello');
// All within 300ms → one entry.

draft.$undo(); // body: ''
```

The first change in a new window pushes a fresh entry. Subsequent changes within
the window replace the top entry. When the window expires, the next change
starts a new one.

A typical setting for text inputs is `batchMs: 300`. For checkbox toggles or
radio selects you probably want `batchMs: 0` so every click is distinctly
undoable.

## Forking the redo stack

Standard undo/redo rules apply: setting a new value after `$undo()` clears the
forward history.

```ts
draft.subject.set('A');
draft.subject.set('B');
draft.$undo(); // subject: 'A', $canRedo: true

draft.subject.set('C'); // fork, redo stack dropped
draft.$canRedo; // false
```

## Bounded depth

`maxDepth` keeps memory usage bounded. When the stack would exceed the limit,
the oldest entries are dropped (not the newest, so you always keep the latest
state).

```ts
const draftScope = withHistory(scope, { maxDepth: 3 });

draft.body.set('first edit');
draft.body.set('second edit');
draft.body.set('third edit');
draft.body.set('fourth edit');

// Stack contains only 3 entries.
draft.$undo(); // body: 'third edit'
draft.$undo(); // body: 'second edit'
draft.$canUndo; // false, entries for earlier states were dropped.
```

## Tracking a subset of fields

By default every value field appears in the snapshot. Pass `fields` to ignore
volatile state like focus, scroll position, or transient UI flags:

```ts
withHistory(scope, { fields: ['to', 'subject', 'body'] });
```

Fields not listed are still reactive; they just aren't restored by `$undo()` /
`$redo()`. Useful for state that should be preserved across a time-travel event
(e.g. "which field is focused") rather than rolled back.

## Undo/redo and other hooks

- **Time travel via `$undo` / `$redo` calls `$setSnapshot`.** Like devtools time
  travel, it skips `beforeChange`; the user didn't mutate, you're restoring
  state.
- **`onChange` still fires.** Whatever other middleware is layered on top
  (persistence, devtools, logging) sees the restoration as a normal batch of
  field changes.
- **Layer composition.** Don't expect `withPersistence` to persist the undo
  stack. The stack lives on the instance, not in fields, and isn't part of
  `$getSnapshot()`. For durable undo across sessions, build it on top with a
  custom `fields` list and serialization.
