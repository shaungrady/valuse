# Undo & Redo

`withHistory` adds an undo/redo stack to a scope. It tracks snapshots of value
fields, exposes `undo()`, `redo()`, `canUndo`, `canRedo`, and `clearHistory()`
on every instance, and keeps memory bounded with a ring buffer.

```ts
import { valueScope, value } from 'valuse';
import { withHistory } from 'valuse/middleware';

const editor = withHistory(
  valueScope({
    title: value<string>(''),
    body: value<string>(''),
  }),
  { maxDepth: 100, batchMs: 300 },
);

const doc = editor.create({ title: 'Untitled', body: '' });
doc.title.set('Draft');
doc.title.set('Draft (v2)');

doc.canUndo; // true
doc.undo(); // title: 'Draft'
doc.undo(); // title: 'Untitled'
doc.redo(); // title: 'Draft'
```

## Table of contents

- [Options](#options)
- [Instance extensions](#instance-extensions)
- [Reactive canUndo / canRedo](#reactive-canundo--canredo)
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
  undo: () => void;
  redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  clearHistory: () => void;
}
```

- `undo()` and `redo()` restore a previous/next snapshot in one atomic
  `$setSnapshot` call. Derivations recompute naturally.
- `canUndo` and `canRedo` are backed by signals — read them in a derivation and
  the derivation re-runs when availability changes.
- `clearHistory()` drops the stack back to the current state. `canUndo` becomes
  `false` immediately.

## Reactive canUndo / canRedo

Because `canUndo` / `canRedo` are signal-backed getters, you can wire them
directly into React components, derivations, or a sibling scope:

```tsx
function UndoButton({ doc }) {
  return (
    <button disabled={!doc.use().canUndo} onClick={doc.undo}>
      Undo
    </button>
  );
}
```

Or in a derivation:

```ts
const editor = withHistory(
  valueScope({
    body: value<string>(''),
    status: ({ scope }) => (scope.canUndo ? 'dirty' : 'clean'),
  }),
);
```

## Recording is synchronous

Unlike `onChange` (which batches on a microtask), history recording is
synchronous. You can call `undo()` immediately after `.set()`:

```ts
doc.title.set('A');
doc.title.set('B');
doc.undo(); // 'A', without awaiting a microtask
```

This is deliberate — undo in a typing context needs to feel instant. The
middleware uses `$subscribe` (backed by a Preact signals `effect`) rather than
`onChange` so each set produces a synchronous snapshot.

## Batched changes

`batchMs` merges rapid changes into a single history entry. Typing "hello" into
an input produces five sets, but only one undo-step should be needed to clear
the word:

```ts
const editor = withHistory(scope, { batchMs: 300 });

doc.body.set('h');
doc.body.set('he');
doc.body.set('hel');
doc.body.set('hell');
doc.body.set('hello');
// All within 300ms → one entry.

doc.undo(); // body: ''
```

The first change in a new window pushes a fresh entry. Subsequent changes within
the window replace the top entry. When the window expires, the next change
starts a new one.

A typical setting for text inputs is `batchMs: 300`. For checkbox toggles or
radio selects you probably want `batchMs: 0` so every click is distinctly
undoable.

## Forking the redo stack

Standard undo/redo rules apply: setting a new value after `undo()` clears the
forward history.

```ts
doc.title.set('A');
doc.title.set('B');
doc.undo(); // title: 'A', canRedo: true

doc.title.set('C'); // fork — redo stack dropped
doc.canRedo; // false
```

## Bounded depth

`maxDepth` keeps memory usage bounded. When the stack would exceed the limit,
the oldest entries are dropped (not the newest — you always keep the latest
state).

```ts
const editor = withHistory(scope, { maxDepth: 3 });

doc.count.set(1);
doc.count.set(2);
doc.count.set(3);
doc.count.set(4);

// Stack contains only 3 entries.
doc.undo(); // count: 3
doc.undo(); // count: 2
doc.canUndo; // false — entries for {0} and {1} were dropped.
```

## Tracking a subset of fields

By default every value field appears in the snapshot. Pass `fields` to ignore
volatile state like focus, scroll position, or transient UI flags:

```ts
withHistory(scope, { fields: ['title', 'body'] });
```

Fields not listed are still reactive — they just aren't restored by `undo()` /
`redo()`. Useful for state that should be preserved across a time-travel event
(e.g. "which item is focused") rather than rolled back.

## Undo/redo and other hooks

- **Time travel via `undo` / `redo` calls `$setSnapshot`.** Like devtools time
  travel, it skips `beforeChange` — the user didn't mutate; you're restoring
  state.
- **`onChange` still fires.** Whatever other middleware is layered on top
  (persistence, devtools, logging) sees the restoration as a normal batch of
  field changes.
- **Layer composition.** Apply `withHistory` before `withPersistence` if you
  want undo stacks persisted with the rest of your state? Don't — the stack
  lives on the instance, not in fields, and isn't part of `$getSnapshot()`. If
  you need durable undo across sessions, that's a feature you'd build on top
  with a custom `fields` list and serialization.
