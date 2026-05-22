import { batchSets } from 'valuse';
import 'valuse/react';
import type { todoWithHistory } from './model.js';

// One instance of the history-wrapped scope: text + soft-delete fields +
// `$undo` / `$redo` / `$canUndo` / `$canRedo` / `$clearHistory`.
type TodoInstance = ReturnType<typeof todoWithHistory.create>;

export function TodoEditor({ todo }: { todo: TodoInstance }) {
	// `text.use()` doubles as the reactivity hook for `$canUndo` / `$canRedo`:
	// every recorded write fires `$subscribe`, which triggers a re-render and
	// re-reads the getters. For a component that doesn't otherwise subscribe to
	// a field, call `todo.$use()` explicitly to keep them in sync.
	const [text, setText] = todo.text.use();

	return (
		<div>
			<input
				value={text}
				onChange={(e) => setText(e.target.value)}
				aria-label="Edit todo text"
			/>
			<button
				type="button"
				disabled={!todo.$canUndo}
				onClick={todo.$undo}
				aria-label="Undo"
			>
				Undo
			</button>
			<button
				type="button"
				disabled={!todo.$canRedo}
				onClick={todo.$redo}
				aria-label="Redo"
			>
				Redo
			</button>
			<button type="button" onClick={todo.$clearHistory}>
				Clear history
			</button>
		</div>
	);
}

export function SoftDeleteButton({ todo }: { todo: TodoInstance }) {
	// Subscribe to the soft-delete signal so the button label flips.
	const [isDeleted, setIsDeleted] = todo.isDeleted.use();

	const toggle = () => {
		// `batchSets` groups the two writes so history records one snapshot —
		// a single Undo reverses the whole delete/restore action.
		batchSets(() => {
			setIsDeleted((prev) => !prev);
			todo.deletedAt.set(isDeleted ? null : Date.now());
		});
	};

	return (
		<button type="button" onClick={toggle}>
			{isDeleted ? 'Restore' : 'Delete'}
		</button>
	);
}
