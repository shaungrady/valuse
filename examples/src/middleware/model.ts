import { value, valueScope, type ScopeTemplate } from 'valuse';
import {
	withDevtools,
	withHistory,
	withPersistence,
	localStorageAdapter,
} from 'valuse/middleware';

// ── A reusable custom middleware: soft-delete ──────────────────────────
// Middleware in valuse is just `(scope) => scope.extendValues(...)`.
// Anything composable into the lifecycle (fields, derivations, hooks)
// goes here. The added fields surface on the returned template's type so
// consumers can read `instance.isDeleted` directly.

export const withSoftDelete = <Def extends Record<string, unknown>>(
	scope: ScopeTemplate<Def>,
) =>
	scope.extendValues({
		isDeleted: value<boolean>(false),
		deletedAt: value<number | null>(null),
	});

// ── Base todo (mirrors the todo-app example) ───────────────────────────

const baseTodo = valueScope({
	id: value<string>(),
	text: value<string>('').pipe((v) => v.trim()),
	completed: value<boolean>(false),
});

// ── Layered templates ──────────────────────────────────────────────────
// Each layer takes a scope and returns a scope, so they stack freely.

export const todoWithSoftDelete = withSoftDelete(baseTodo);

export const todoWithHistory = withHistory(todoWithSoftDelete, {
	maxDepth: 50,
	batchMs: 0, // immediate snapshots for predictable tests
});

/**
 * Build a `withPersistence`-wrapped template against the given storage key.
 * Each test passes its own key so they don't share localStorage state.
 */
export function buildPersistedTemplate(key: string) {
	return withPersistence(todoWithHistory, {
		key,
		adapter: localStorageAdapter,
		throttle: 0, // immediate writes for tests
	});
}

/**
 * Build a `withDevtools`-wrapped template. Devtools is a no-op when the
 * browser extension isn't installed (which is always the case in tests), so
 * this just verifies the wrapper composes without breaking.
 */
export function buildDevtoolsTemplate(key: string) {
	return withDevtools(buildPersistedTemplate(key), { name: key });
}
