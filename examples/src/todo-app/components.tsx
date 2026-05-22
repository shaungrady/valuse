import { useState } from 'react';
import 'valuse/react';
import type { TodoApp, FilterValue } from './model.js';

export function TodoList({ app }: { app: TodoApp }) {
	const keys = app.todos.useKeys();
	const [currentFilter] = app.filter.use();

	const visible = keys.filter((id) => {
		const todo = app.todos.get(id);
		if (!todo) return false;
		if (currentFilter === 'active') return !todo.completed.get();
		if (currentFilter === 'completed') return todo.completed.get();
		return true;
	});

	return (
		<ul>
			{visible.map((id) => (
				<TodoItem key={id} id={id} app={app} />
			))}
		</ul>
	);
}

export function TodoItem({ id, app }: { id: string; app: TodoApp }) {
	const todo = app.todos.get(id);
	if (!todo) return null;

	const [completed, setCompleted] = todo.completed.use();
	const [text] = todo.text.use();

	return (
		<li>
			<input
				type="checkbox"
				checked={completed}
				onChange={() => setCompleted((prev) => !prev)}
				aria-label={`Mark "${text}" complete`}
			/>
			<span>{text}</span>
		</li>
	);
}

export function AddTodo({ app }: { app: TodoApp }) {
	// Local form input. useState is the right tool here; a new value() per
	// render would reset on every keystroke.
	const [text, setText] = useState('');

	const add = () => {
		if (!text.trim()) return;
		const id = crypto.randomUUID();
		app.todos.set(id, { id, text });
		setText('');
	};

	return (
		<div>
			<input
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder="What needs doing?"
				aria-label="New todo"
			/>
			<button onClick={add}>Add</button>
		</div>
	);
}

const FILTERS: ReadonlyArray<{ value: FilterValue; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'active', label: 'Active' },
	{ value: 'completed', label: 'Completed' },
];

export function Footer({ app }: { app: TodoApp }) {
	const keys = app.todos.useKeys();
	const [currentFilter, setFilter] = app.filter.use();

	const activeCount = keys.filter((id) => {
		const todo = app.todos.get(id);
		return todo ? !todo.completed.get() : false;
	}).length;

	return (
		<footer>
			<span>{activeCount} items left</span>
			{FILTERS.map((f) => (
				<button
					key={f.value}
					onClick={() => setFilter(f.value)}
					aria-pressed={currentFilter === f.value}
				>
					{f.label}
				</button>
			))}
		</footer>
	);
}
