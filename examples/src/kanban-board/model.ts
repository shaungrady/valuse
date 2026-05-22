import {
	value,
	valueRef,
	valueScope,
	type AsyncDerivationContext,
	type SyncDerivationContext,
	type Value,
	type ValueRef,
	type ValueSet,
} from 'valuse';
import type { ScopeMap } from 'valuse';

// ── Card scope ────────────────────────────────────────────────────────
// Every card has these typed fields. `allowUndeclaredProperties: true` lets
// boards attach arbitrary metadata (priority, story points, etc.) that
// passes through without being reactive.

// Field-only alias used to type the *derivation* contexts (sync/async).
// Lifecycle hooks (onCreate, onChange, …) are inferred from the surrounding
// `valueScope` call and don't need an explicit annotation.
type CardFields = {
	id: Value<string | undefined, string | undefined>;
	title: Value<string, string>;
	columnId: Value<string | undefined, string | undefined>;
	position: Value<number, number>;
	assignee: Value<string | null, string | null>;
	createdAt: Value<number, number>;
	isDragging: Value<boolean, boolean>;
	isSelected: Value<boolean, boolean>;
};

export const cardScope = valueScope(
	{
		id: value<string>(),
		title: value<string>('').pipe((v) => v.trim()),
		columnId: value<string>(),
		position: value<number>(0),
		assignee: value<string | null>(null),
		createdAt: value<number>(0),

		// Preview-only UI state.
		isDragging: value<boolean>(false),
		isSelected: value<boolean>(false),
	},
	{
		onCreate: ({ scope }) => {
			// Hydrated cards arrive with createdAt set; new cards get `now`.
			if (!scope.createdAt.get()) scope.createdAt.set(Date.now());
		},
		allowUndeclaredProperties: true,
	},
);

// ── Card type specialization via .extend() ────────────────────────────

type BugCardFields = CardFields & {
	severity: Value<
		'low' | 'medium' | 'high' | 'critical',
		'low' | 'medium' | 'high' | 'critical'
	>;
	stepsToReproduce: Value<string, string>;
};
type BugCardCtx = SyncDerivationContext<BugCardFields>;

export const bugCardScope = cardScope.extend({
	severity: value<'low' | 'medium' | 'high' | 'critical'>('medium'),
	stepsToReproduce: value<string>(''),
	isCritical: ({ scope }: BugCardCtx) => scope.severity.use() === 'critical',
});

type FeatureCardFields = CardFields & {
	storyPoints: Value<number, number>;
	acceptanceCriteria: Value<string, string>;
};
type FeatureCardCtx = SyncDerivationContext<FeatureCardFields>;

export const featureCardScope = cardScope.extend({
	storyPoints: value<number>(0),
	acceptanceCriteria: value<string>(''),
	isEstimated: ({ scope }: FeatureCardCtx) => scope.storyPoints.use() > 0,
});

// ── Column scope ──────────────────────────────────────────────────────

type ColumnFields = {
	id: Value<string | undefined, string | undefined>;
	name: Value<string, string>;
	cardIds: Value<string[], string[]>;
};
type ColumnCtx = SyncDerivationContext<ColumnFields>;

export const columnScope = valueScope({
	id: value<string>(),
	name: value<string>(''),
	// Pipe ensures cardIds is always a unique set, even if the caller passes
	// duplicates from the API.
	cardIds: value<string[]>([]).pipe((ids) => [...new Set(ids)]),

	cardCount: ({ scope }: ColumnCtx) => scope.cardIds.use().length,
	isEmpty: ({ scope }: ColumnCtx) => scope.cardIds.use().length === 0,
});

// ── Board API response shape (kept minimal) ──────────────────────────

interface BoardApiResponse {
	id: string;
	name: string;
	columns: { id: string; name: string; cardIds?: string[] }[];
	cards: { id: string; title: string; columnId: string; createdAt?: number }[];
}

// ── Board scope ───────────────────────────────────────────────────────
// Owns its own card + column collections per instance via factory refs.
// `data` is async and hydrates the collections via `onChange`.

// Field-only alias for the board's derivation contexts. Includes the ref
// fields and the async `data` derivation's resolved type so downstream
// sync derivations can read them typed. The onChange hook below doesn't
// need this — its scope is inferred from the surrounding valueScope.
type BoardFields = {
	boardId: Value<string | undefined, string | undefined>;
	filterAssignee: Value<string | null, string | null>;
	cards: ValueRef<ScopeMap<string, CardFields & { _: ValueSet<string> }>>;
	columns: ValueRef<ScopeMap<string, ColumnFields>>;
	data: Value<BoardApiResponse | undefined, BoardApiResponse | undefined>;
};
type BoardCtx = SyncDerivationContext<BoardFields>;
type BoardAsyncCtx = AsyncDerivationContext<BoardFields>;

export const boardScope = valueScope(
	{
		boardId: value<string>(),
		filterAssignee: value<string | null>(null),

		cards: valueRef(() => cardScope.createMap<string>()),
		columns: valueRef(() => columnScope.createMap<string>()),

		// Async derivation. Aborts the previous fetch when boardId changes.
		data: async ({
			scope,
			signal,
		}: BoardAsyncCtx): Promise<BoardApiResponse | undefined> => {
			const id = scope.boardId.use();
			if (!id) return undefined;
			const res = await fetch(`/api/boards/${id}`, { signal });
			return res.json() as Promise<BoardApiResponse>;
		},

		name: ({ scope }: BoardCtx) => scope.data.use()?.name ?? 'Loading...',
		columnOrder: ({ scope }: BoardCtx) =>
			scope.data.use()?.columns?.map((c) => c.id) ?? [],
		columnCount: ({ scope }: BoardCtx) => scope.columns.use().size,
	},
	{
		// When the async `data` resolves, hydrate the card + column maps from it.
		onChange: ({ scope, changes }) => {
			const dataChanged = [...changes].some((c) => c.path === 'data');
			if (!dataChanged) return;
			const data = scope.data.get();
			if (!data) return;

			const { columns, cards } = scope;
			for (const col of data.columns) columns.set(col.id, col);
			for (const c of data.cards) cards.set(c.id, c);
		},
	},
);

export type BoardInstance = ReturnType<typeof boardScope.create>;

/**
 * Imperative move between columns. Two field updates only the source/dest
 * columns and the moved card see — every other card/column is untouched.
 */
export function moveCard(
	board: BoardInstance,
	cardId: string,
	fromColumnId: string,
	toColumnId: string,
	toIndex: number,
): void {
	const { columns, cards } = board;
	const fromCol = columns.get(fromColumnId);
	const toCol = columns.get(toColumnId);
	if (!fromCol || !toCol) return;

	fromCol.cardIds.set((ids) => ids.filter((id) => id !== cardId));
	toCol.cardIds.set((ids) => {
		const next = [...ids];
		next.splice(toIndex, 0, cardId);
		return next;
	});

	cards.get(cardId)?.columnId.set(toColumnId);
}
