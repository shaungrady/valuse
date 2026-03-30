# Example: Kanban Board

A kanban board with columns containing cards. Cards have fixed fields plus
user-defined custom fields per board. This showcases nested scopes via
`valueRef`, `allowUndeclaredProperties` for dynamic card metadata, `extend()`
for card type specialization, and `createMap()` for both collections.

## The model

### Cards

```ts
import { value, valueRef, valueScope } from "valuse";

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
    onInit: ({ set }) => {
      set("createdAt", Date.now());
    },
    // Boards can attach arbitrary fields (priority, story points, due date, etc.)
    allowUndeclaredProperties: true,
  },
);

const cards = card.createMap();
```

### Card type specialization via extend()

```ts
const bugCard = card.extend({
  severity: value<"low" | "medium" | "high" | "critical">("medium"),
  stepsToReproduce: value<string>(""),

  isCritical: (get) => get("severity") === "critical",
});

const featureCard = card.extend({
  storyPoints: value<number>(0),
  acceptanceCriteria: value<string>(""),

  isEstimated: (get) => get("storyPoints") > 0,
});
```

### Columns

```ts
const column = valueScope({
  id: value<string>(),
  name: value<string>(),
  cardIds: value<string[]>([]), // ordered list of card IDs in this column

  cardCount: (get) => get("cardIds").length,
  isEmpty: (get) => get("cardIds").length === 0,
});

const columns = column.createMap();
```

### The board

```ts
const board = valueScope({
  name: value<string>("My Board"),
  columnOrder: value<string[]>([]), // ordered column IDs

  // Shared filter — all cards can see this via valueRef
  filterAssignee: value<string | null>(null),
});

const boardInstance = board.create({
  columnOrder: ["todo", "in-progress", "done"],
});

// Initialize columns
columns.set("todo", { id: "todo", name: "To Do" });
columns.set("in-progress", { id: "in-progress", name: "In Progress" });
columns.set("done", { id: "done", name: "Done" });
```

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
  const fromCol = columns.get(fromColumnId);
  const toCol = columns.get(toColumnId);
  if (!fromCol || !toCol) return;

  // Remove from source
  fromCol.set("cardIds", (ids) => ids.filter((id) => id !== cardId));

  // Insert at position in destination
  toCol.set("cardIds", (ids) => {
    const next = [...ids];
    next.splice(toIndex, 0, cardId);
    return next;
  });

  // Update the card's column reference
  cards.get(cardId)?.set("columnId", toColumnId);
}
```

Only the two affected columns and the moved card re-render. Every other column
and card is untouched.

## React components

```tsx
import { value, valueScope } from "valuse/react";

function Board() {
  // Only re-renders when columns are added/removed/reordered
  const [get] = boardInstance.use();

  return (
    <div className="board">
      {get("columnOrder").map((colId) => (
        <Column key={colId} id={colId} />
      ))}
    </div>
  );
}

function Column({ id }: { id: string }) {
  // Re-renders when this column's cards change (add/remove/reorder),
  // but NOT when a card's title or assignee is edited
  const [get] = columns.use(id);

  return (
    <div className="column">
      <h2>
        {get("name")} ({get("cardCount")})
      </h2>
      {get("cardIds").map((cardId) => (
        <Card key={cardId} id={cardId} />
      ))}
    </div>
  );
}

function Card({ id }: { id: string }) {
  // Subscribes to this card only — other cards don't re-render
  const [get, set] = cards.use(id);

  return (
    <div
      draggable
      onDragStart={() => set("isDragging", true)}
      onDragEnd={() => set("isDragging", false)}
      style={{ opacity: get("isDragging") ? 0.5 : 1 }}
    >
      <h3>{get("title")}</h3>
      <span>{get("assignee") ?? "Unassigned"}</span>

      {/* Custom fields from allowUndeclaredProperties */}
      {get("severity") && <span className="badge">{get("severity")}</span>}
      {get("storyPoints") && <span>{get("storyPoints")} pts</span>}
    </div>
  );
}
```

## allowUndeclaredProperties for custom fields

Boards often let users define their own card fields — priority, due date, story
points, labels. These come from a config endpoint, not the type system:

```ts
// API returns the board's custom field schema
const customFields = await fetch("/api/boards/123/fields");
// [{ key: "priority", type: "select" }, { key: "dueDate", type: "date" }]

// When creating a card, pass the custom fields along.
// Known fields (title, columnId, etc.) are reactive.
// Custom fields (priority, dueDate) are preserved as passthrough.
cards.set("card-1", {
  id: "card-1",
  title: "Fix login bug",
  columnId: "todo",
  priority: "high",
  dueDate: "2026-04-15",
} as any);

// Read them back
cards.get("card-1")?.get("priority"); // "high"
```

If a custom field needs to become reactive later (e.g., you want derived state
based on `priority`), promote it with `extend()`:

```ts
const prioritizedCard = card.extend({
  priority: value<"low" | "medium" | "high">("medium"),

  isUrgent: (get) => get("priority") === "high" && get("assignee") === null,
});
```

## Nested access

The board instance exposes the filter. A card component can read it via the
board's scope:

```tsx
function FilteredCard({ id }: { id: string }) {
  const [get] = cards.use(id);

  // Access the board's filter through its scope instance
  const filterAssignee = boardInstance.use("filterAssignee");
  // Returns [value] since filterAssignee is a value, not derived

  const dimmed =
    filterAssignee[0] !== null && get("assignee") !== filterAssignee[0];

  return (
    <div style={{ opacity: dimmed ? 0.3 : 1 }}>
      <h3>{get("title")}</h3>
    </div>
  );
}
```

Or use `valueRef` to bake the filter into the card scope itself:

```ts
const card = valueScope({
  // ... other fields ...
  filterAssignee: valueRef(boardInstance), // ref to the board scope

  isFiltered: (get) => {
    const board = get("filterAssignee");
    const filter = board.get("filterAssignee");
    return filter !== null && get("assignee") !== filter;
  },
});
```

## Persistence with onChange and getSnapshot

```ts
const card = valueScope(
  {
    id: value<string>(),
    title: value<string>().pipe((v) => v.trim()),
    columnId: value<string>(),
    position: value<number>(0),
    assignee: value<string | null>(null),
    createdAt: value<number>(0),
  },
  {
    onChange: ({ changes, set, get, getSnapshot }) => {
      // One-liner persistence — getSnapshot() captures everything
      debounce(() => saveCard(get("id"), getSnapshot()), 500);
    },
  },
);
```

## Why scopes fit this model

| Kanban concept            | ValUse equivalent                                                |
| ------------------------- | ---------------------------------------------------------------- |
| Card with typed fields    | `valueScope({ title: value<string>(), ... })`                    |
| Card type (bug, feature)  | `card.extend({ severity: value<string>() })`                     |
| Custom fields per board   | `allowUndeclaredProperties: true`                                |
| Column with ordered cards | `valueScope({ cardIds: value<string[]>([]) })`                   |
| All cards / all columns   | `card.createMap()` / `column.createMap()`                        |
| Drag-and-drop             | Two `set("cardIds", ...)` calls on the affected columns          |
| Board-level filter        | `valueRef(boardInstance)` or direct `boardInstance.use("field")` |
| Per-card persistence      | `onChange` + `getSnapshot()`                                     |
| Per-card re-renders       | `cards.use(id)` — automatic isolation                            |
