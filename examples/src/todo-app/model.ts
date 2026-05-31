import { value, valueScope } from 'valuse';
import { pipeEnum } from 'valuse/utils';

export const filterValues = ['all', 'active', 'completed'] as const;
export type FilterValue = (typeof filterValues)[number];

// Variadic form: fields layer, derivation layer, config layer. `scope`
// inside each callback is inferred from the surrounding layers — no
// manual context annotation needed.
export const todoScope = valueScope(
	{
		id: value<string>(),
		text: value<string>('').pipe((v) => v.trim()),
		completed: value<boolean>(false),
		createdAt: value<number>(0),
	},
	{
		label: ({ scope }) =>
			scope.completed.use() ?
				`[x] ${scope.text.use()}`
			:	`[ ] ${scope.text.use()}`,
	},
	{
		onCreate: ({ scope }) => {
			// Preserve a hydrated createdAt (e.g. from storage); otherwise stamp now.
			if (!scope.createdAt.get()) scope.createdAt.set(Date.now());
		},
	},
);

/**
 * Build a fresh todo-app instance. Tests use this to get isolated state; an
 * app would typically call it once at module scope.
 */
export function createTodoApp() {
	const todos = todoScope.createMap<string>();
	const filter = value<FilterValue>('all').pipe(pipeEnum(filterValues));
	return { todos, filter };
}

export type TodoApp = ReturnType<typeof createTodoApp>;
