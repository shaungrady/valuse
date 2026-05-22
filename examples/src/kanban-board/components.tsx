import 'valuse/react';
import type { BoardInstance } from './model.js';

export function Board({ board }: { board: BoardInstance }) {
	const [columnOrder] = board.columnOrder.use();
	const [, dataState] = board.data.useAsync();

	if (dataState.status === 'setting' && !dataState.hasValue) {
		return <div aria-label="Board loading">Loading…</div>;
	}
	if (dataState.status === 'error') {
		return (
			<div aria-label="Board error" role="alert">
				Failed to load board
			</div>
		);
	}

	return (
		<div aria-label="Board">
			{columnOrder.map((colId: string) => (
				<Column key={colId} id={colId} board={board} />
			))}
		</div>
	);
}

export function Column({ id, board }: { id: string; board: BoardInstance }) {
	const col = board.columns.get(id);
	if (!col) return null;

	const [name] = col.name.use();
	const [cardCountRaw] = col.cardCount.use();
	const cardCount = cardCountRaw as number;
	const [cardIdsRaw] = col.cardIds.use();
	const cardIds = cardIdsRaw as string[];

	return (
		<section aria-label={`Column ${name}`}>
			<h2>
				{name} ({cardCount})
			</h2>
			{cardIds.map((cardId) => (
				<Card key={cardId} id={cardId} board={board} />
			))}
		</section>
	);
}

export function Card({ id, board }: { id: string; board: BoardInstance }) {
	const card = board.cards.get(id);
	if (!card) return null;

	const [title] = card.title.use();
	const [assignee] = card.assignee.use();
	const [isDragging, setIsDragging] = card.isDragging.use();

	return (
		<article
			aria-label={`Card ${title}`}
			data-dragging={isDragging ? 'true' : 'false'}
			onPointerDown={() => setIsDragging(true)}
			onPointerUp={() => setIsDragging(false)}
		>
			<h3>{title}</h3>
			<span>{assignee ?? 'Unassigned'}</span>
		</article>
	);
}
