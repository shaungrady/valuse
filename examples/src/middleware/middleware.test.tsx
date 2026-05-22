import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
	buildDevtoolsTemplate,
	buildPersistedTemplate,
	todoWithHistory,
	todoWithSoftDelete,
} from './model.js';
import { SoftDeleteButton, TodoEditor } from './components.js';

// Each test that touches localStorage uses a unique key so other tests aren't
// affected by leaked state. Clearing localStorage outright would interfere with
// other example suites if they ran in the same worker.
let keyCounter = 0;
const uniqueKey = () => `middleware-test-${keyCounter++}-${Date.now()}`;

describe('middleware: withSoftDelete', () => {
	it('adds isDeleted and deletedAt fields with defaults', () => {
		const todo = todoWithSoftDelete.create({ id: 't1', text: 'a' });
		expect(todo.isDeleted.get()).toBe(false);
		expect(todo.deletedAt.get()).toBe(null);
	});

	it('preserves the original fields alongside extension fields', () => {
		const todo = todoWithSoftDelete.create({
			id: 't1',
			text: '  a  ',
			completed: true,
		});
		// Pipe still runs.
		expect(todo.text.get()).toBe('a');
		expect(todo.completed.get()).toBe(true);
		expect(todo.isDeleted.get()).toBe(false);
	});

	it('toggling isDeleted is a normal field write', () => {
		const todo = todoWithSoftDelete.create({ id: 't1', text: 'a' });
		todo.isDeleted.set(true);
		todo.deletedAt.set(123);
		expect(todo.isDeleted.get()).toBe(true);
		expect(todo.deletedAt.get()).toBe(123);
	});
});

describe('middleware: withHistory', () => {
	it('records snapshots and undo/redo restores them', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		expect(todo.$canUndo).toBe(false);

		todo.text.set('ab');
		todo.text.set('abc');
		expect(todo.$canUndo).toBe(true);
		expect(todo.$canRedo).toBe(false);

		todo.$undo();
		expect(todo.text.get()).toBe('ab');
		expect(todo.$canRedo).toBe(true);

		todo.$undo();
		expect(todo.text.get()).toBe('a');

		todo.$redo();
		expect(todo.text.get()).toBe('ab');
	});

	it('a new write after undo clears the redo stack (fork)', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		todo.text.set('ab');
		todo.text.set('abc');
		todo.$undo();
		expect(todo.$canRedo).toBe(true);

		todo.text.set('forked');
		expect(todo.$canRedo).toBe(false);
		expect(todo.text.get()).toBe('forked');
	});

	it('$clearHistory drops the stack to the current state', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		todo.text.set('b');
		todo.text.set('c');
		expect(todo.$canUndo).toBe(true);

		todo.$clearHistory();
		expect(todo.$canUndo).toBe(false);
		expect(todo.$canRedo).toBe(false);
		expect(todo.text.get()).toBe('c');
	});

	it('history layers over soft-delete: undo restores isDeleted', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		todo.isDeleted.set(true);
		expect(todo.isDeleted.get()).toBe(true);

		todo.$undo();
		expect(todo.isDeleted.get()).toBe(false);
	});
});

describe('middleware: withPersistence', () => {
	beforeEach(() => {
		// Each test runs against jsdom's localStorage; clean it between runs so
		// tests in this file don't bleed state into each other.
		localStorage.clear();
	});

	it('hydrates from localStorage on create when the key exists', () => {
		const key = uniqueKey();
		localStorage.setItem(
			key,
			JSON.stringify({ id: 't1', text: 'hydrated', completed: true }),
		);

		const tmpl = buildPersistedTemplate(key);
		const todo = tmpl.create({ id: 't1', text: 'initial' });
		// Stored values win over the create() input.
		expect(todo.text.get()).toBe('hydrated');
		expect(todo.completed.get()).toBe(true);
	});

	it('writes to localStorage when a field changes', () => {
		const key = uniqueKey();
		const tmpl = buildPersistedTemplate(key);
		const todo = tmpl.create({ id: 't1', text: 'a' });

		todo.text.set('b');

		// `onChange` is microtask-batched. Wait one tick.
		return Promise.resolve().then(() => {
			const raw = localStorage.getItem(key);
			expect(raw).not.toBe(null);
			const stored = JSON.parse(raw!);
			expect(stored.text).toBe('b');
		});
	});

	it('writes survive across instances (durable hydration)', async () => {
		const key = uniqueKey();
		const tmpl = buildPersistedTemplate(key);

		const first = tmpl.create({ id: 't1', text: 'first' });
		first.text.set('second');
		await Promise.resolve();
		first.$destroy();

		const second = tmpl.create({ id: 't1', text: 'ignored' });
		expect(second.text.get()).toBe('second');
	});
});

describe('middleware: withDevtools', () => {
	it('composes without errors when the extension is absent', () => {
		// jsdom doesn't have the Redux DevTools extension, so withDevtools
		// should no-op cleanly. The wrapped template must still produce a
		// usable instance.
		const key = uniqueKey();
		const tmpl = buildDevtoolsTemplate(key);
		const todo = tmpl.create({ id: 't1', text: 'a' });

		expect(todo.text.get()).toBe('a');
		todo.text.set('b');
		expect(todo.text.get()).toBe('b');
		expect(todo.$canUndo).toBe(true);
	});
});

describe('middleware: composed components', () => {
	it('TodoEditor: clicking Undo restores prior text', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		render(<TodoEditor todo={todo} />);

		const input = screen.getByLabelText('Edit todo text') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'ab' } });
		fireEvent.change(input, { target: { value: 'abc' } });
		expect(todo.text.get()).toBe('abc');

		fireEvent.click(screen.getByLabelText('Undo'));
		expect(todo.text.get()).toBe('ab');
		expect(input.value).toBe('ab');
	});

	it('TodoEditor: Undo button disabled at history start', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		render(<TodoEditor todo={todo} />);

		const undoBtn = screen.getByLabelText('Undo') as HTMLButtonElement;
		expect(undoBtn.disabled).toBe(true);

		fireEvent.change(
			screen.getByLabelText('Edit todo text') as HTMLInputElement,
			{ target: { value: 'changed' } },
		);
		expect(undoBtn.disabled).toBe(false);
	});

	it('SoftDeleteButton toggles isDeleted and stamps deletedAt', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		render(<SoftDeleteButton todo={todo} />);

		const btn = screen.getByRole('button');
		expect(btn.textContent).toBe('Delete');

		fireEvent.click(btn);
		expect(todo.isDeleted.get()).toBe(true);
		expect(typeof todo.deletedAt.get()).toBe('number');
		expect(btn.textContent).toBe('Restore');

		fireEvent.click(btn);
		expect(todo.isDeleted.get()).toBe(false);
		expect(todo.deletedAt.get()).toBe(null);
	});

	it('SoftDeleteButton + undo: clicking Delete then $undo restores', () => {
		const todo = todoWithHistory.create({ id: 't1', text: 'a' });
		render(<SoftDeleteButton todo={todo} />);

		fireEvent.click(screen.getByRole('button'));
		expect(todo.isDeleted.get()).toBe(true);

		act(() => todo.$undo());
		expect(todo.isDeleted.get()).toBe(false);
		// Button re-renders to reflect new state.
		expect(screen.getByRole('button').textContent).toBe('Delete');
	});
});
