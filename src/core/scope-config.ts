import type { Change, ScopeNode } from './types.js';
import type { HookScope, ValueInputOf } from './scope-types.js';

/**
 * Lifecycle hooks and options for a scope.
 *
 * @remarks
 * Scope configuration allows you to intercept changes, respond to lifecycle events,
 * and enable advanced features like undeclared property passthrough.
 *
 * `scope` inside each hook is typed against the surrounding definition
 * passed to `valueScope`. When the generic is left at its default (e.g.
 * by middleware that doesn't know the concrete shape), `scope` falls
 * back to a permissive `GenericScopeInstance`.
 *
 * @typeParam Def - the scope definition record.
 */
export interface ScopeConfig<
	Def extends Record<string, unknown> = Record<string, unknown>,
> {
	/**
	 * When `true`, preserve properties not declared in the scope definition
	 * as plain, non-reactive passthrough data.
	 *
	 * @defaultValue `false`
	 */
	allowUndeclaredProperties?: boolean;

	/**
	 * Fires once after the instance is created.
	 *
	 * @param context.scope - the scope instance tree.
	 * @param context.input - the raw input passed to `.create()`.
	 * @param context.signal - `AbortSignal` that aborts when the instance is destroyed.
	 * @param context.onCleanup - register a cleanup function that runs on destroy.
	 *
	 * @example
	 * ```ts
	 * onCreate: ({ scope, signal, onCleanup }) => {
	 *   document.addEventListener('resize', () => scope.width.set(innerWidth), { signal });
	 *   const timer = setInterval(() => scope.tick.set(Date.now()), 1000);
	 *   onCleanup(() => clearInterval(timer));
	 * }
	 * ```
	 */
	onCreate?: (context: {
		scope: HookScope<Def>;
		input: Partial<ValueInputOf<Def>> | undefined;
		signal: AbortSignal;
		onCleanup: (fn: () => void) => void;
	}) => void;

	/**
	 * Fires when `$destroy()` is called on the instance.
	 *
	 * @param context - object containing the scope instance.
	 */
	onDestroy?: (context: { scope: HookScope<Def> }) => void;

	/**
	 * Fires on a microtask after one or more value fields change. Changes are batched.
	 *
	 * @param context - change metadata including the affected scope nodes.
	 *
	 * @example
	 * ```ts
	 * onChange: ({ changes }) => {
	 *   console.log(`${changes.size} fields changed`);
	 * }
	 * ```
	 */
	onChange?: (context: {
		scope: HookScope<Def>;
		changes: Set<Change>;
		changesByScope: Map<ScopeNode, Change[]>;
	}) => void;

	/**
	 * Fires synchronously before value fields are written.
	 * Can prevent individual or all changes.
	 *
	 * @param context - change metadata and a `prevent()` function.
	 *
	 * @example
	 * ```ts
	 * beforeChange: ({ changes, prevent }) => {
	 *   for (const change of changes) {
	 *     if (change.key === 'locked') prevent(change);
	 *   }
	 * }
	 * ```
	 */
	beforeChange?: (context: {
		scope: HookScope<Def>;
		changes: Set<Change>;
		changesByScope: Map<ScopeNode, Change[]>;
		prevent: (target?: ScopeNode | Change) => void;
	}) => void;

	/**
	 * Fires when the first subscriber attaches to any reactive field in the scope.
	 *
	 * @param context.scope - the scope instance tree.
	 * @param context.signal - `AbortSignal` that aborts when the last subscriber detaches.
	 * @param context.onCleanup - register a cleanup function that runs on detach.
	 */
	onUsed?: (context: {
		scope: HookScope<Def>;
		signal: AbortSignal;
		onCleanup: (fn: () => void) => void;
	}) => void;

	/**
	 * Fires when the last subscriber detaches from all reactive fields in the scope.
	 *
	 * @param context - object containing the scope instance.
	 */
	onUnused?: (context: { scope: HookScope<Def> }) => void;

	/**
	 * Cross-field validation. A reactive derivation that returns
	 * `StandardSchemaV1.Issue[]`. Re-evaluates when any `.use()`'d
	 * dependency changes. Issues with a `path` matching a field name
	 * are routed to that field's validation state.
	 */
	validate?: (context: { scope: HookScope<Def> }) => {
		readonly message: string;
		readonly path?:
			| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
			| undefined;
	}[];
}

/** Merge two scope configs, running both hooks in order. @internal */
export function mergeConfigs(
	base: ScopeConfig | undefined,
	extension: ScopeConfig | undefined,
): ScopeConfig | undefined {
	if (!base && !extension) return undefined;
	if (!base) return extension;
	if (!extension) return base;

	const merged: ScopeConfig = {};
	const allowUndeclared =
		extension.allowUndeclaredProperties ?? base.allowUndeclaredProperties;
	if (allowUndeclared !== undefined)
		merged.allowUndeclaredProperties = allowUndeclared;

	const onCreate = mergeHook(base.onCreate, extension.onCreate);
	if (onCreate) merged.onCreate = onCreate;
	const onDestroy = mergeHook(base.onDestroy, extension.onDestroy);
	if (onDestroy) merged.onDestroy = onDestroy;
	const onChange = mergeHook(base.onChange, extension.onChange);
	if (onChange) merged.onChange = onChange;
	const beforeChange = mergeHook(base.beforeChange, extension.beforeChange);
	if (beforeChange) merged.beforeChange = beforeChange;
	const onUsed = mergeHook(base.onUsed, extension.onUsed);
	if (onUsed) merged.onUsed = onUsed;
	const onUnused = mergeHook(base.onUnused, extension.onUnused);
	if (onUnused) merged.onUnused = onUnused;

	// validate hooks concatenate their issues
	if (base.validate || extension.validate) {
		const baseValidate = base.validate;
		const extValidate = extension.validate;
		merged.validate = (context) => {
			const baseIssues = baseValidate ? baseValidate(context) : [];
			const extIssues = extValidate ? extValidate(context) : [];
			return [...baseIssues, ...extIssues];
		};
	}

	return merged;
}

function mergeHook<Args extends readonly unknown[]>(
	base: ((...args: Args) => void) | undefined,
	extension: ((...args: Args) => void) | undefined,
): ((...args: Args) => void) | undefined {
	if (!base) return extension;
	if (!extension) return base;
	return (...args: Args) => {
		base(...args);
		extension(...args);
	};
}
