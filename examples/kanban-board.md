# Example: Kanban Board

A kanban board with columns containing cards. Cards have fixed fields plus
user-defined custom fields per board. This showcases async derivations for data
fetching, `allowUndeclaredProperties` for dynamic card metadata, `extend()` for
card type specialization, and `createMap()` for both collections. See
[Async Derivations](../docs/async-derivations.md),
[Extending Scopes](../docs/extending.md), and [Scope Map](../docs/scope-map.md)
for the underlying APIs.

## The model

### Cards

```ts
import { value, valueRef, valueScope } from 'valuse';

// Base card — every card has these fields
const card = valueScope(
  {
    id: value<string>(),
    title: value<string>().pipe((v) => v.trim()),
    columnId: value<string>(),
    position: value<number>(0),
    assignee: value<string | null>(null),
    createdAt: value<number>(0),

    // Preview-only state
    isDragging: value<boolean>(false),
    isSelected: value<boolean>(false),
  },
  {
    onCreate: ({ scope }) => {
      // Only set if not already provided (e.g., hydrated from API)
      if (!scope.createdAt.get()) scope.createdAt.set(Date.now());
    },
    // Boards can attach arbitrary fields (priority, story points, due date, etc.)
    allowUndeclaredProperties: true,
  },
);
```

### Card type specialization via extend()

```ts
const bugCard = card.extend({
  severity: value<'low' | 'medium' | 'high' | 'critical'>('medium'),
  stepsToReproduce: value<string>(''),

  isCritical: ({ scope }) => scope.severity.use() === 'critical',
});

const featureCard = card.extend({
  storyPoints: value<number>(0),
  acceptanceCriteria: value<string>(''),

  isEstimated: ({ scope }) => scope.storyPoints.use() > 0,
});
```

### Columns

```ts
const column = valueScope({
  id: value<string>(),
  name: value<string>(),
  // ordered list of unique card IDs in this column
  cardIds: value<string[]>([]).pipe((ids) => [...new Set(ids)]),

  cardCount: ({ scope }) => scope.cardIds.use().length,
  isEmpty: ({ scope }) => scope.cardIds.use().length === 0,
});
```

### The board

The board owns the card and column collections via `valueRef` factories — each
`board.create()` gets its own independent maps. The per-field `onChange` on
`data` hydrates the collections when the async fetch resolves:

```ts
const board = valueScope(
  {
    boardId: value<string>(),
    filterAssignee: value<string | null>(null),

    // Per-instance collections — each board gets its own maps
    cards: valueRef(() => card.createMap()),
    columns: valueRef(() => column.createMap()),

    // Async derivation: fetches board data when boardId changes.
    // Aborts the previous fetch automatically.
    data: async ({ scope, signal }) => {
      const id = scope.boardId.use();
      const res = await fetch(`/api/boards/${id}`, { signal });
      return res.json();
    },

    // Sync derivations read the async data without knowing it's async.
    name: ({ scope }) => scope.data.use()?.name ?? 'Loading...',
    columnOrder: ({ scope }) =>
      scope.data.use()?.columns?.map((c: any) => c.id) ?? [],

    // Derivation reacts to column map key changes
    columnCount: ({ scope }) => scope.columns.use().size,
  },
  {
    onChange: ({ scope, changes }) => {
      const dataChanged = [...changes].some((c) => c.path === 'data');
      if (!dataChanged) return;
      const data = scope.data.get();
      if (!data) return;

      const columns = scope.columns.get();
      const cards = scope.cards.get();

      // Hydrate collections from fetched data
      for (const col of data.columns) columns.set(col.id, col);
      for (const c of data.cards) cards.set(c.id, c);
    },
  },
);

let boardInstance: ReturnType<typeof board.create>;
```

### Hydrating from async data

The board's `data` derivation fetches from the API. When it resolves, the
per-field `onChange` handler populates the card and column collections
automatically — no manual `subscribe` needed:

```ts
function initBoard(boardId: string) {
  boardInstance = board.create({ boardId });
}
```

Cards from the API arrive with `createdAt` already set, so `onCreate` preserves
it. New cards created client-side get `Date.now()` as the fallback. If `boardId`
changes later, the previous request is aborted and a new fetch starts
automatically.

## Drag and drop

Moving a card between columns is two field updates — remove from source, add to
destination. No store-wide spread, no reducer, no action:

```ts
function moveCard(
  cardId: string,
  fromColumnId: string,
  toColumnId: string,
  toIndex: number,
) {
  const columns = boardInstance.columns.get();
  const cards = boardInstance.cards.get();
  const fromCol = columns.get(fromColumnId);
  const toCol = columns.get(toColumnId);
  if (!fromCol || !toCol) return;

  // Remove from source
  fromCol.cardIds.set((ids) => ids.filter((id) => id !== cardId));

  // Insert at position in destination
  toCol.cardIds.set((ids) => {
    const next = [...ids];
    next.splice(toIndex, 0, cardId);
    return next;
  });

  // Update the card's column reference
  cards.get(cardId)?.columnId.set(toColumnId);
}
```

Only the two affected columns and the moved card re-render. Every other column
and card is untouched.

## React components

```tsx
import 'valuse/react';

// Pull collections from the board
const columns = boardInstance.columns.get();
const cards = boardInstance.cards.get();

function Board() {
  const [columnOrder] = boardInstance.columnOrder.use();
  // useAsync() on the board's async `data` derivation gives us loading
  // and error state, separately from the hydrated `columns` map.
  const [, dataState] = boardInstance.data.useAsync();

  if (dataState.status === 'setting' && !dataState.hasValue) {
    return <BoardSkeleton />;
  }
  if (dataState.status === 'error') {
    return <BoardError error={dataState.error} />;
  }

  return (
    <div className="board">
      {columnOrder.map((colId: string) => (
        <Column key={colId} id={colId} />
      ))}
    </div>
  );
}

function Column({ id }: { id: string }) {
  const col = columns.get(id)!;
  const [name] = col.name.use();
  const [cardCount] = col.cardCount.use();
  const [cardIds] = col.cardIds.use();

  return (
    <div className="column">
      <h2>
        {name} ({cardCount})
      </h2>
      {cardIds.map((cardId) => (
        <Card key={cardId} id={cardId} />
      ))}
    </div>
  );
}

function Card({ id }: { id: string }) {
  const cardInstance = cards.get(id)!;
  const [title] = cardInstance.title.use();
  const [assignee] = cardInstance.assignee.use();
  const [isDragging, setIsDragging] = cardInstance.isDragging.use();

  return (
    <div
      draggable
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <h3>{title}</h3>
      <span>{assignee ?? 'Unassigned'}</span>
    </div>
  );
}
```

## Going further

### Custom fields from an API

Boards often let users define their own card fields. Since the card scope has
`allowUndeclaredProperties: true`, dynamic fields from an API are preserved
alongside the typed ones:

```ts
cards.set('card-1', {
  id: 'card-1',
  title: 'Fix login bug',
  columnId: 'todo',
  // Dynamic fields from the API — preserved as passthrough
  priority: 'high',
  dueDate: '2026-04-15',
} as any);

cards.get('card-1')?.priority.get(); // "high"
```

If a dynamic field later needs reactivity or derived state, promote it with
`extend()`:

```ts
const prioritizedCard = card.extend({
  priority: value<'low' | 'medium' | 'high'>('medium'),
  isUrgent: ({ scope }) =>
    scope.priority.use() === 'high' && scope.assignee.use() === null,
});
```

### Board-level filtering

A card component can subscribe to the board's filter directly, without prop
drilling or context:

```tsx
function FilteredCard({ id }: { id: string }) {
  const cardInstance = cards.get(id)!;
  const [assignee] = cardInstance.assignee.use();
  const [title] = cardInstance.title.use();
  const [filterAssignee] = boardInstance.filterAssignee.use();

  const dimmed = filterAssignee !== null && assignee !== filterAssignee;

  return (
    <div style={{ opacity: dimmed ? 0.3 : 1 }}>
      <h3>{title}</h3>
    </div>
  );
}
```

### Auto-saving with onChange

Add persistence to the card scope without touching the components. The `changes`
map lets you skip UI-only fields:

```ts
const card = valueScope(
  {
    /* ...fields from above... */
  },
  {
    onChange: ({ scope, changes }) => {
      // Persist only when a non-UI field changed
      const shouldPersist = [...changes].some(
        (c) => c.path !== 'isDragging' && c.path !== 'isSelected',
      );
      if (!shouldPersist) return;
      debounce(() => saveCard(scope.id.get(), scope.$getSnapshot()), 500);
    },
  },
);
```

Want to archive cards instead of deleting them? See the
[soft delete middleware](middleware.md#soft-delete) for a reusable `extend()`
pattern that adds `isDeleted` and `deletedAt` to any scope.
