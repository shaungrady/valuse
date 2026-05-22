import { value, valueScope } from 'valuse';
import { pipeEnum } from 'valuse/utils';

export const filterValues = ['all', 'active', 'completed'] as const;
export type FilterValue = (typeof filterValues)[number];

// The `{ scope: any }` annotations on derivations / hooks match the pattern in
// the internal test suite; valueScope doesn't currently infer the derivation
// context for `({ scope })` callbacks, so strict mode flags it otherwise.
export const todoScope = valueScope(
	{
		id: value<string>(),
		text: value<string>('').pipe((v) => v.trim()),
		completed: value<boolean>(false),
		createdAt: value<number>(0),

		label: ({ scope }: { scope: any }) =>
			scope.completed.use() ?
				`[x] ${scope.text.use()}`
			:	`[ ] ${scope.text.use()}`,
	},
	{
		onCreate: ({ scope }: { scope: any }) => {
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
