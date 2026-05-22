import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { createTodoApp, todoScope } from './model.js';
import { AddTodo, Footer, TodoItem, TodoList } from './components.js';

describe('todo-app: model', () => {
	it('creates an empty collection', () => {
		const app = createTodoApp();
		expect(app.todos.size).toBe(0);
		expect(app.filter.get()).toBe('all');
	});

	it('stamps createdAt on create when not provided', () => {
		const before = Date.now();
		const inst = todoScope.create({ id: 't1', text: 'buy milk' });
		const after = Date.now();
		expect(inst.createdAt.get()).toBeGreaterThanOrEqual(before);
		expect(inst.createdAt.get()).toBeLessThanOrEqual(after);
	});

	it('preserves a hydrated createdAt (e.g. from storage)', () => {
		const inst = todoScope.create({
			id: 't1',
			text: 'buy milk',
			createdAt: 12345,
		});
		expect(inst.createdAt.get()).toBe(12345);
	});

	it('trims text via the pipe', () => {
		const inst = todoScope.create({ id: 't1', text: '   buy milk   ' });
		expect(inst.text.get()).toBe('buy milk');
	});

	it('label derivation reflects completed state', () => {
		const inst = todoScope.create({ id: 't1', text: 'buy milk' });
		expect(inst.label.get()).toBe('[ ] buy milk');
		inst.completed.set(true);
		expect(inst.label.get()).toBe('[x] buy milk');
	});

	it('filter pipeEnum narrows invalid input to the first option', () => {
		const app = createTodoApp();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		app.filter.set('bogus' as any);
		expect(app.filter.get()).toBe('all');
	});

	it('createMap.set creates new entry; .delete removes', () => {
		const app = createTodoApp();
		app.todos.set('t1', { id: 't1', text: 'a' });
		app.todos.set('t2', { id: 't2', text: 'b' });
		expect(app.todos.size).toBe(2);
		expect(app.todos.get('t1')?.text.get()).toBe('a');
		app.todos.delete('t1');
		expect(app.todos.size).toBe(1);
		expect(app.todos.has('t1')).toBe(false);
	});
});

describe('todo-app: components', () => {
	let app: ReturnType<typeof createTodoApp>;
	beforeEach(() => {
		app = createTodoApp();
	});

	it('AddTodo: typing + clicking Add inserts a todo and clears input', () => {
		render(<AddTodo app={app} />);
		const input = screen.getByLabelText('New todo') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'walk the dog' } });
		fireEvent.click(screen.getByText('Add'));
		expect(app.todos.size).toBe(1);
		const id = app.todos.keys()[0]!;
		expect(app.todos.get(id)?.text.get()).toBe('walk the dog');
		expect(input.value).toBe('');
	});

	it('AddTodo: blank input is a no-op', () => {
		render(<AddTodo app={app} />);
		fireEvent.click(screen.getByText('Add'));
		expect(app.todos.size).toBe(0);
	});

	it('TodoList renders entries and updates when the collection grows', () => {
		app.todos.set('t1', { id: 't1', text: 'a' });
		app.todos.set('t2', { id: 't2', text: 'b' });
		render(<TodoList app={app} />);
		expect(screen.getAllByRole('listitem')).toHaveLength(2);

		// Model mutations from outside fireEvent must be wrapped in act() so
		// React flushes the subscriber-driven re-render before we assert.
		act(() => {
			app.todos.set('t3', { id: 't3', text: 'c' });
		});
		expect(screen.getAllByRole('listitem')).toHaveLength(3);
	});

	it('TodoItem: toggling the checkbox flips completed', () => {
		app.todos.set('t1', { id: 't1', text: 'a' });
		render(<TodoItem id="t1" app={app} />);
		const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		fireEvent.click(checkbox);
		expect(app.todos.get('t1')?.completed.get()).toBe(true);
		expect(checkbox.checked).toBe(true);
	});

	it('TodoList honors filter changes (active hides completed)', () => {
		app.todos.set('t1', { id: 't1', text: 'a' });
		app.todos.set('t2', { id: 't2', text: 'b', completed: true });
		render(<TodoList app={app} />);
		expect(screen.getAllByRole('listitem')).toHaveLength(2);

		act(() => {
			app.filter.set('active');
		});
		expect(screen.getAllByRole('listitem')).toHaveLength(1);
		expect(screen.getByText('a')).toBeDefined();

		act(() => {
			app.filter.set('completed');
		});
		expect(screen.getAllByRole('listitem')).toHaveLength(1);
		expect(screen.getByText('b')).toBeDefined();
	});

	it('Footer activeCount reflects the key list on add/remove', () => {
		// Per the Footer's design comment: re-renders on add/remove but NOT on
		// per-todo field changes. Aggregate-on-toggle would require something
		// like a deep-subscribe API on ScopeMap.
		app.todos.set('t1', { id: 't1', text: 'a' });
		const { container } = render(<Footer app={app} />);
		const footer = container.querySelector('footer')!;
		expect(within(footer).getByText('1 items left')).toBeDefined();

		act(() => {
			app.todos.set('t2', { id: 't2', text: 'b' });
		});
		expect(within(footer).getByText('2 items left')).toBeDefined();

		act(() => {
			app.todos.delete('t1');
		});
		expect(within(footer).getByText('1 items left')).toBeDefined();
	});

	it('Footer filter buttons set the filter and reflect aria-pressed', () => {
		render(<Footer app={app} />);
		const activeBtn = screen.getByRole('button', { name: 'Active' });
		expect(activeBtn.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(activeBtn);
		expect(app.filter.get()).toBe('active');
		expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
	});
});
