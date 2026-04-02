# Example: Kanban Board

A kanban board with columns containing cards. Cards have fixed fields plus
user-defined custom fields per board. This showcases async derivations for data
fetching, `allowUndeclaredProperties` for dynamic card metadata, `extend()` for
card type specialization, and `createMap()` for both collections.

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
    onInit: ({ set, get }) => {
      // Only set if not already provided (e.g., hydrated from API)
      if (!get('createdAt')) set('createdAt', Date.now());
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

  isCritical: ({ use }) => use('severity') === 'critical',
});

const featureCard = card.extend({
  storyPoints: value<number>(0),
  acceptanceCriteria: value<string>(''),

  isEstimated: ({ use }) => use('storyPoints') > 0,
});
```

### Columns

```ts
const column = valueScope({
  id: value<string>(),
  name: value<string>(),
  // ordered list of unique card IDs in this column
  cardIds: value<string[]>([]).pipe((ids) => [...new Set(ids)]),

  cardCount: ({ use }) => use('cardIds').length,
  isEmpty: ({ use }) => use('cardIds').length === 0,
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

    // Async derivation — fetches board data when boardId changes.
    // Aborts the previous fetch automatically.
    data: async ({ use, signal }) => {
      const id = use('boardId');
      const res = await fetch(`/api/boards/${id}`, { signal });
      return res.json();
    },

    // Sync derivations — read the async data without knowing it's async.
    name: ({ use }) => use('data')?.name ?? 'Loading...',
    columnOrder: ({ use }) => use('data')?.columns?.map((c) => c.id) ?? [],

    // Derivation reacts to column map key changes
    columnCount: ({ use }) => use('columns').size,
  },
  {
    onChange: {
      data: ({ to, get }) => {
        if (!to) return;
        const columns = get('columns');
        const cards = get('cards');

        // Hydrate collections from fetched data
        for (const col of to.columns) columns.set(col.id, col);
        for (const c of to.cards) cards.set(c.id, c);
      },
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

Cards from the API arrive with `createdAt` already set, so `onInit` preserves
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
  const columns = boardInstance.get('columns');
  const cards = boardInstance.get('cards');
  const fromCol = columns.get(fromColumnId);
  const toCol = columns.get(toColumnId);
  if (!fromCol || !toCol) return;

  // Remove from source
  fromCol.set('cardIds', (ids) => ids.filter((id) => id !== cardId));

  // Insert at position in destination
  toCol.set('cardIds', (ids) => {
    const next = [...ids];
    next.splice(toIndex, 0, cardId);
    return next;
  });

  // Update the card's column reference
  cards.get(cardId)?.set('columnId', toColumnId);
}
```

Only the two affected columns and the moved card re-render. Every other column
and card is untouched.

## React components

```tsx
import { value, valueScope } from 'valuse/react';

// Pull collections from the board — no module-level variables needed
const columns = boardInstance.get('columns');
const cards = boardInstance.get('cards');

function Board() {
  const [columnOrder] = boardInstance.use('columnOrder');

  return (
    <div className="board">
      {columnOrder.map((colId) => (
        <Column key={colId} id={colId} />
      ))}
    </div>
  );
}

function Column({ id }: { id: string }) {
  const [getColumn] = columns.use(id);

  return (
    <div className="column">
      <h2>
        {getColumn('name')} ({getColumn('cardCount')})
      </h2>
      {getColumn('cardIds').map((cardId) => (
        <Card key={cardId} id={cardId} />
      ))}
    </div>
  );
}

function Card({ id }: { id: string }) {
  const [getCard, setCard] = cards.use(id);

  return (
    <div
      draggable
      onDragStart={() => setCard('isDragging', true)}
      onDragEnd={() => setCard('isDragging', false)}
      style={{ opacity: getCard('isDragging') ? 0.5 : 1 }}
    >
      <h3>{getCard('title')}</h3>
      <span>{getCard('assignee') ?? 'Unassigned'}</span>

      {/* Custom fields from allowUndeclaredProperties */}
      {getCard('severity') && (
        <span className="badge">{getCard('severity')}</span>
      )}
      {getCard('storyPoints') && <span>{getCard('storyPoints')} pts</span>}
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

cards.get('card-1')?.get('priority'); // "high"
```

If a dynamic field later needs reactivity or derived state, promote it with
`extend()`:

```ts
const prioritizedCard = card.extend({
  priority: value<'low' | 'medium' | 'high'>('medium'),
  isUrgent: ({ use }) => use('priority') === 'high' && use('assignee') === null,
});
```

### Board-level filtering

A card component can subscribe to the board's filter directly, without prop
drilling or context:

```tsx
function FilteredCard({ id }: { id: string }) {
  const [getCard] = cards.use(id);
  const [filterAssignee] = boardInstance.use('filterAssignee');

  const dimmed =
    filterAssignee !== null && getCard('assignee') !== filterAssignee;

  return (
    <div style={{ opacity: dimmed ? 0.3 : 1 }}>
      <h3>{getCard('title')}</h3>
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
    onChange: ({ changes, get, getSnapshot }) => {
      // Skip UI-only changes
      if (changes.has('isDragging') || changes.has('isSelected')) return;
      debounce(() => saveCard(get('id'), getSnapshot()), 500);
    },
  },
);
```

Want to archive cards instead of deleting them? See the
[soft delete middleware](middleware.md#soft-delete) for a reusable `extend()`
pattern that adds `isDeleted` and `deletedAt` to any scope.
