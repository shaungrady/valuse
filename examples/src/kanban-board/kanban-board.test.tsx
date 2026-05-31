import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import {
	boardScope,
	bugCardScope,
	cardScope,
	columnScope,
	featureCardScope,
	moveCard,
} from './model.js';
import { Board, Card, Column } from './components.js';

// Minimal API fixture. Different tests can swap this body by reassigning
// the variable before triggering the board create.
let mockApi: () => Promise<unknown> = async () => ({});

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
			if (init?.signal?.aborted)
				throw new DOMException('aborted', 'AbortError');
			const body = await mockApi();
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('kanban-board: cardScope', () => {
	it('trims the title via pipe', () => {
		const c = cardScope.create({ id: 'c1', title: '  Hello  ', columnId: 'a' });
		expect(c.title.get()).toBe('Hello');
	});

	it('stamps createdAt on create when not provided', () => {
		const before = Date.now();
		const c = cardScope.create({ id: 'c1', title: 'a', columnId: 'col' });
		const after = Date.now();
		expect(c.createdAt.get()).toBeGreaterThanOrEqual(before);
		expect(c.createdAt.get()).toBeLessThanOrEqual(after);
	});

	it('preserves hydrated createdAt', () => {
		const c = cardScope.create({
			id: 'c1',
			title: 'a',
			columnId: 'col',
			createdAt: 123,
		});
		expect(c.createdAt.get()).toBe(123);
	});

	it('allowUndeclaredProperties preserves extras as plain data', () => {
		const c = cardScope.create({
			id: 'c1',
			title: 'a',
			columnId: 'col',
			// Extras pass through, untyped, non-reactive.
			priority: 'high',
			storyPoints: 5,
		} as Parameters<typeof cardScope.create>[0]);
		expect((c as unknown as { priority: string }).priority).toBe('high');
		expect((c as unknown as { storyPoints: number }).storyPoints).toBe(5);
	});
});

describe('kanban-board: extended cards', () => {
	it('bugCard adds severity + isCritical', () => {
		const bug = bugCardScope.create({
			id: 'c1',
			title: 'crash',
			columnId: 'col',
			severity: 'critical',
		});
		expect(bug.isCritical.get()).toBe(true);
		bug.severity.set('low');
		expect(bug.isCritical.get()).toBe(false);
	});

	it('featureCard adds storyPoints + isEstimated', () => {
		const feat = featureCardScope.create({
			id: 'c1',
			title: 'feat',
			columnId: 'col',
		});
		expect(feat.isEstimated.get()).toBe(false);
		feat.storyPoints.set(3);
		expect(feat.isEstimated.get()).toBe(true);
	});
});

describe('kanban-board: columnScope', () => {
	it('cardIds pipe deduplicates', () => {
		const col = columnScope.create({ id: 'col', name: 'Todo' });
		col.cardIds.set(['a', 'a', 'b', 'c', 'b']);
		expect(col.cardIds.get()).toEqual(['a', 'b', 'c']);
	});

	it('cardCount + isEmpty derive from cardIds', () => {
		const col = columnScope.create({ id: 'col', name: 'Todo' });
		expect(col.isEmpty.get()).toBe(true);
		expect(col.cardCount.get()).toBe(0);

		col.cardIds.set(['a', 'b']);
		expect(col.cardCount.get()).toBe(2);
		expect(col.isEmpty.get()).toBe(false);
	});
});

describe('kanban-board: boardScope async hydration', () => {
	it('async data derivation resolves and is readable', async () => {
		mockApi = async () => ({
			id: 'b1',
			name: 'Read',
			columns: [],
			cards: [],
		});
		const board = boardScope.create({ boardId: 'b1' });
		await waitFor(() => {
			const d = board.data.getAsync();
			expect(d.status).toBe('set');
		});
		expect(board.name.get()).toBe('Read');
	});

	it('onChange fires when async data resolves (path: "data")', async () => {
		const seen: string[] = [];
		mockApi = async () => ({ id: 'b1', name: 'X', columns: [], cards: [] });
		const probe = boardScope.extendConfig({
			onChange: ({ changes }: { changes: Set<any> }) => {
				for (const c of changes) seen.push(c.path);
			},
		});
		probe.create({ boardId: 'b1' });
		await waitFor(() => {
			expect(seen).toContain('data');
		});
	});

	it('hydrates columns + cards from the async data', async () => {
		mockApi = async () => ({
			id: 'b1',
			name: 'My Board',
			columns: [
				{ id: 'todo', name: 'Todo' },
				{ id: 'done', name: 'Done' },
			],
			cards: [
				{ id: 'c1', title: 'Walk dog', columnId: 'todo' },
				{ id: 'c2', title: 'Read book', columnId: 'done' },
			],
		});

		const board = boardScope.create({ boardId: 'b1' });

		// Subscribe to keys so we have a way to wait for hydration.
		await waitFor(() => {
			expect(board.columns.size).toBe(2);
			expect(board.cards.size).toBe(2);
		});

		expect(board.columns.get('todo')?.name.get()).toBe('Todo');
		expect(board.cards.get('c1')?.title.get()).toBe('Walk dog');
		expect(board.name.get()).toBe('My Board');
		expect(board.columnOrder.get()).toEqual(['todo', 'done']);
	});

	it('factory refs give each board instance its own collections', async () => {
		mockApi = async () => ({
			id: 'b1',
			name: 'A',
			columns: [{ id: 'todo', name: 'Todo' }],
			cards: [{ id: 'c1', title: 'card', columnId: 'todo' }],
		});

		const boardA = boardScope.create({ boardId: 'a' });
		const boardB = boardScope.create({ boardId: 'b' });

		await waitFor(() => {
			expect(boardA.cards.size).toBe(1);
			expect(boardB.cards.size).toBe(1);
		});

		// Mutating A's card doesn't affect B.
		boardA.cards.get('c1')!.title.set('A-edit');
		expect(boardB.cards.get('c1')!.title.get()).toBe('card');
	});

	it('changing boardId aborts the pending fetch (cancellation)', async () => {
		// Capture each fetch's signal so we can assert the first one aborted
		// when boardId changed.
		const seenSignals: AbortSignal[] = [];
		let resolveFirst!: (v: unknown) => void;

		vi.stubGlobal(
			'fetch',
			vi.fn((url: string, init?: { signal?: AbortSignal }) => {
				if (init?.signal) seenSignals.push(init.signal);
				if (url.includes('b1')) {
					return new Promise((resolve) => {
						resolveFirst = (body) =>
							resolve(
								new Response(JSON.stringify(body), {
									headers: { 'Content-Type': 'application/json' },
								}),
							);
					});
				}
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: 'b2',
							name: 'Second',
							columns: [],
							cards: [],
						}),
						{ headers: { 'Content-Type': 'application/json' } },
					),
				);
			}),
		);

		const board = boardScope.create({ boardId: 'b1' });
		await new Promise((r) => setTimeout(r, 0));

		board.boardId.set('b2');
		await waitFor(() => expect(seenSignals[0]?.aborted).toBe(true));

		// First resolve is now stale; landing it shouldn't overwrite state.
		resolveFirst({ id: 'b1', name: 'First', columns: [], cards: [] });
		await waitFor(() => expect(board.name.get()).toBe('Second'));
	});
});

describe('kanban-board: moveCard', () => {
	const seedTwoColumns = async () => {
		mockApi = async () => ({
			id: 'b',
			name: 'B',
			columns: [
				{ id: 'todo', name: 'Todo' },
				{ id: 'done', name: 'Done' },
			],
			cards: [
				{ id: 'c1', title: 'A', columnId: 'todo' },
				{ id: 'c2', title: 'B', columnId: 'todo' },
			],
		});
		const board = boardScope.create({ boardId: 'b' });
		await waitFor(() => {
			expect(board.columns.size).toBe(2);
			expect(board.cards.size).toBe(2);
		});
		// Hydrate cardIds on the columns. The minimal API fixture omits
		// `cardIds` per column, so we seed them locally.
		board.columns.get('todo')!.cardIds.set(['c1', 'c2']);
		return board;
	};

	it('moves a card from one column to another and updates columnId', async () => {
		const board = await seedTwoColumns();
		moveCard(board, 'c1', 'todo', 'done', 0);
		expect(board.columns.get('todo')!.cardIds.get()).toEqual(['c2']);
		expect(board.columns.get('done')!.cardIds.get()).toEqual(['c1']);
		expect(board.cards.get('c1')!.columnId.get()).toBe('done');
	});

	it('is a no-op for an unknown source or destination column', async () => {
		const board = await seedTwoColumns();
		const before = board.columns.get('todo')!.cardIds.get();
		moveCard(board, 'c1', 'nonexistent', 'done', 0);
		expect(board.columns.get('todo')!.cardIds.get()).toEqual(before);
	});
});

describe('kanban-board: components', () => {
	it('Board shows a loading state, then renders columns when data resolves', async () => {
		mockApi = async () => ({
			id: 'b1',
			name: 'B',
			columns: [{ id: 'todo', name: 'Todo' }],
			cards: [{ id: 'c1', title: 'A', columnId: 'todo' }],
		});

		const board = boardScope.create({ boardId: 'b1' });
		render(<Board board={board} />);

		expect(screen.getByLabelText('Board loading')).toBeDefined();

		// findByLabelText retries until the column renders or the timeout hits.
		// Implicitly verifies that Board re-renders with BOTH the resolved
		// async state (loading branch exits) AND the propagated columnOrder
		// derivation in the same React commit — otherwise the loading branch
		// would exit but no column would appear (regression for the atomic
		// async-result write batching).
		const col = await screen.findByLabelText('Column Todo');
		expect(col).toBeDefined();
		expect(screen.queryByLabelText('Board loading')).toBeNull();
	});

	it('Card shows the title and assignee', async () => {
		mockApi = async () => ({
			id: 'b1',
			name: 'B',
			columns: [{ id: 'todo', name: 'Todo' }],
			cards: [{ id: 'c1', title: 'Walk dog', columnId: 'todo' }],
		});
		const board = boardScope.create({ boardId: 'b1' });
		await waitFor(() => expect(board.cards.size).toBe(1));

		render(<Card id="c1" board={board} />);
		expect(screen.getByLabelText('Card Walk dog')).toBeDefined();
		expect(screen.getByText('Unassigned')).toBeDefined();
	});

	it('Column header shows live card count', async () => {
		mockApi = async () => ({
			id: 'b1',
			name: 'B',
			columns: [{ id: 'todo', name: 'Todo' }],
			cards: [{ id: 'c1', title: 'A', columnId: 'todo' }],
		});
		const board = boardScope.create({ boardId: 'b1' });
		await waitFor(() => expect(board.columns.size).toBe(1));
		// API fixture doesn't include cardIds on columns; seed them.
		act(() => board.columns.get('todo')!.cardIds.set(['c1']));

		render(<Column id="todo" board={board} />);
		expect(screen.getByText(/^Todo \(1\)$/)).toBeDefined();

		act(() => board.columns.get('todo')!.cardIds.set(['c1', 'c2']));
		expect(screen.getByText(/^Todo \(2\)$/)).toBeDefined();
	});
});
