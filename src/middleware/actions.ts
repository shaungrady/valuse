import {
	asUnknownValueScope,
	type ScopeTemplate,
} from '../core/value-scope.js';
import type { AugmentedScopeTemplate } from '../core/augmented-template.js';
import type { ScopeInstance } from '../core/scope-types.js';

/**
 * The context handed to each action factory.
 *
 * @typeParam Def - the scope definition record.
 * @typeParam InExt - augmentations already on the instance (prior
 *   middleware, plus earlier action layers).
 */
export interface ActionContext<Def extends Record<string, unknown>, InExt> {
	/**
	 * The live instance: fields, derivations, `$`-methods, augmentations
	 * from prior middleware, and actions from earlier layers.
	 */
	scope: ScopeInstance<Def> & InExt;
	/**
	 * Aborts when the instance is destroyed. Pass to `fetch`, or check
	 * `signal.aborted` after an `await` to bail out of a stale async action.
	 */
	signal: AbortSignal;
	/**
	 * Register teardown scoped to **this invocation**. Cleanups run when the
	 * call settles (sync return or resolved/rejected promise) or when the
	 * instance is destroyed mid-flight — whichever comes first, exactly once.
	 * Safe to call after an `await`. A cleanup registered *after* the instance
	 * is destroyed is skipped (the instance is already torn down).
	 */
	onCleanup: (fn: () => void) => void;
}

/**
 * An action layer: a record of curried factories. The factory receives the
 * {@link ActionContext} and returns the action — the public callable that
 * lands on the instance.
 *
 * The constraint references `Def`/`InExt` but never the layer itself, so
 * contextual typing of `({ scope }) => …` is preserved. To call a sibling
 * action with full typing, declare it in an earlier layer.
 */
export type ActionLayer<Def extends Record<string, unknown>, InExt> = Record<
	string,
	(ctx: ActionContext<Def, InExt>) => (...args: never[]) => unknown
>;

/** Project a layer's factories to the instance members they produce. */
export type ActionMembers<A> = {
	[K in keyof A]: A[K] extends (ctx: never) => infer Fn ? Fn : never;
};

// Accumulators — each step ANDs the next layer's members onto the prior
// channel, so layer N+1's context sees layers 1..N. Mirrors valueScope's
// AccN derivation-layer threading. (`I` = incoming InExt.)
type AAcc1<I, A1> = I & ActionMembers<A1>;
type AAcc2<I, A1, A2> = AAcc1<I, A1> & ActionMembers<A2>;
type AAcc3<I, A1, A2, A3> = AAcc2<I, A1, A2> & ActionMembers<A3>;
type AAcc4<I, A1, A2, A3, A4> = AAcc3<I, A1, A2, A3> & ActionMembers<A4>;
type AAcc5<I, A1, A2, A3, A4, A5> = AAcc4<I, A1, A2, A3, A4> &
	ActionMembers<A5>;
type AAcc6<I, A1, A2, A3, A4, A5, A6> = AAcc5<I, A1, A2, A3, A4, A5> &
	ActionMembers<A6>;
type AAcc7<I, A1, A2, A3, A4, A5, A6, A7> = AAcc6<I, A1, A2, A3, A4, A5, A6> &
	ActionMembers<A7>;
// prettier-ignore
type AAcc8<I, A1, A2, A3, A4, A5, A6, A7, A8> =
	AAcc7<I, A1, A2, A3, A4, A5, A6, A7> & ActionMembers<A8>;
// prettier-ignore
type AAcc9<I, A1, A2, A3, A4, A5, A6, A7, A8, A9> =
	AAcc8<I, A1, A2, A3, A4, A5, A6, A7, A8> & ActionMembers<A9>;
// prettier-ignore
type AAcc10<I, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10> =
	AAcc9<I, A1, A2, A3, A4, A5, A6, A7, A8, A9> & ActionMembers<A10>;
// prettier-ignore
type AAcc11<I, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11> =
	AAcc10<I, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10> & ActionMembers<A11>;

type RuntimeFactory = (ctx: {
	scope: Record<string, unknown>;
	signal: AbortSignal;
	onCleanup: (fn: () => void) => void;
}) => (...args: never[]) => unknown;

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		value != null && typeof (value as { then?: unknown }).then === 'function'
	);
}

/**
 * Build the callable attached to the instance. The factory runs **per
 * invocation** so its `onCleanup` closes over a fresh per-call cleanup list
 * — which is why `onCleanup` works even after `await`s (the inner async
 * function closes over the same context). Cleanups run when the call
 * settles or the instance is destroyed mid-flight, exactly once.
 *
 * In-flight calls register their `runCleanups` in the shared `pending` set
 * rather than each adding an `'abort'` listener — one listener per instance
 * (registered in `onCreate`) fans out to all of them, so concurrent async
 * actions can't accumulate listeners (no `MaxListenersExceededWarning`).
 */
function makeAction(
	factory: RuntimeFactory,
	scope: Record<string, unknown>,
	instanceSignal: AbortSignal,
	pending: Set<() => void>,
): (...args: unknown[]) => unknown {
	return (...args) => {
		let cleanups: Array<() => void> | null = null;
		let cleaned = false;
		const runCleanups = (): void => {
			if (cleaned) return;
			cleaned = true;
			pending.delete(runCleanups);
			if (cleanups) {
				for (const fn of cleanups) fn();
				cleanups = null;
			}
		};

		let result: unknown;
		try {
			const inner = factory({
				scope,
				signal: instanceSignal,
				onCleanup: (fn) => {
					if (cleaned) {
						// Registered after this call's cleanups already ran: if the
						// instance is destroyed the teardown is moot (and could throw
						// touching a torn-down scope), so skip it. Otherwise the call
						// settled normally — run it now.
						if (!instanceSignal.aborted) fn();
						return;
					}
					cleanups ??= [];
					cleanups.push(fn);
				},
			}) as (...a: unknown[]) => unknown;
			result = inner(...args);
		} catch (error) {
			runCleanups();
			throw error;
		}

		if (isThenable(result)) {
			pending.add(runCleanups);
			void Promise.resolve(result).then(runCleanups, runCleanups);
		} else {
			runCleanups();
		}
		return result;
	};
}

// 1 layer (also the plain record form).
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
): AugmentedScopeTemplate<Def, AAcc1<I, A1>>;
// 2 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
): AugmentedScopeTemplate<Def, AAcc2<I, A1, A2>>;
// 3 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
): AugmentedScopeTemplate<Def, AAcc3<I, A1, A2, A3>>;
// 4 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
): AugmentedScopeTemplate<Def, AAcc4<I, A1, A2, A3, A4>>;
// 5 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
): AugmentedScopeTemplate<Def, AAcc5<I, A1, A2, A3, A4, A5>>;
// 6 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
	A6 extends ActionLayer<Def, AAcc5<I, A1, A2, A3, A4, A5>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
	l6: A6,
): AugmentedScopeTemplate<Def, AAcc6<I, A1, A2, A3, A4, A5, A6>>;
// 7 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
	A6 extends ActionLayer<Def, AAcc5<I, A1, A2, A3, A4, A5>>,
	A7 extends ActionLayer<Def, AAcc6<I, A1, A2, A3, A4, A5, A6>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
	l6: A6,
	l7: A7,
): AugmentedScopeTemplate<Def, AAcc7<I, A1, A2, A3, A4, A5, A6, A7>>;
// 8 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
	A6 extends ActionLayer<Def, AAcc5<I, A1, A2, A3, A4, A5>>,
	A7 extends ActionLayer<Def, AAcc6<I, A1, A2, A3, A4, A5, A6>>,
	A8 extends ActionLayer<Def, AAcc7<I, A1, A2, A3, A4, A5, A6, A7>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
	l6: A6,
	l7: A7,
	l8: A8,
): AugmentedScopeTemplate<Def, AAcc8<I, A1, A2, A3, A4, A5, A6, A7, A8>>;
// 9 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
	A6 extends ActionLayer<Def, AAcc5<I, A1, A2, A3, A4, A5>>,
	A7 extends ActionLayer<Def, AAcc6<I, A1, A2, A3, A4, A5, A6>>,
	A8 extends ActionLayer<Def, AAcc7<I, A1, A2, A3, A4, A5, A6, A7>>,
	A9 extends ActionLayer<Def, AAcc8<I, A1, A2, A3, A4, A5, A6, A7, A8>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
	l6: A6,
	l7: A7,
	l8: A8,
	l9: A9,
): AugmentedScopeTemplate<Def, AAcc9<I, A1, A2, A3, A4, A5, A6, A7, A8, A9>>;
// 10 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
	A6 extends ActionLayer<Def, AAcc5<I, A1, A2, A3, A4, A5>>,
	A7 extends ActionLayer<Def, AAcc6<I, A1, A2, A3, A4, A5, A6>>,
	A8 extends ActionLayer<Def, AAcc7<I, A1, A2, A3, A4, A5, A6, A7>>,
	A9 extends ActionLayer<Def, AAcc8<I, A1, A2, A3, A4, A5, A6, A7, A8>>,
	A10 extends ActionLayer<Def, AAcc9<I, A1, A2, A3, A4, A5, A6, A7, A8, A9>>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
	l6: A6,
	l7: A7,
	l8: A8,
	l9: A9,
	l10: A10,
): AugmentedScopeTemplate<
	Def,
	AAcc10<I, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10>
>;
// 11 layers
export function withActions<
	Def extends Record<string, unknown>,
	I,
	A1 extends ActionLayer<Def, I>,
	A2 extends ActionLayer<Def, AAcc1<I, A1>>,
	A3 extends ActionLayer<Def, AAcc2<I, A1, A2>>,
	A4 extends ActionLayer<Def, AAcc3<I, A1, A2, A3>>,
	A5 extends ActionLayer<Def, AAcc4<I, A1, A2, A3, A4>>,
	A6 extends ActionLayer<Def, AAcc5<I, A1, A2, A3, A4, A5>>,
	A7 extends ActionLayer<Def, AAcc6<I, A1, A2, A3, A4, A5, A6>>,
	A8 extends ActionLayer<Def, AAcc7<I, A1, A2, A3, A4, A5, A6, A7>>,
	A9 extends ActionLayer<Def, AAcc8<I, A1, A2, A3, A4, A5, A6, A7, A8>>,
	A10 extends ActionLayer<Def, AAcc9<I, A1, A2, A3, A4, A5, A6, A7, A8, A9>>,
	A11 extends ActionLayer<
		Def,
		AAcc10<I, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10>
	>,
>(
	t: AugmentedScopeTemplate<Def, I>,
	l1: A1,
	l2: A2,
	l3: A3,
	l4: A4,
	l5: A5,
	l6: A6,
	l7: A7,
	l8: A8,
	l9: A9,
	l10: A10,
	l11: A11,
): AugmentedScopeTemplate<
	Def,
	AAcc11<I, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11>
>;

/**
 * Wrap a scope template so each instance gains typed, imperative
 * **actions** — named methods that read and write the scope.
 *
 * @remarks
 * Actions are declared in ordered **layers**. An action in a later layer
 * can call actions from earlier layers (typed), mirroring how a later
 * derivation layer sees earlier derivations. Actions within the *same*
 * layer cannot see each other — split them across layers to compose.
 *
 * Each action is `({ scope, signal, onCleanup }) => (...args) => result`.
 * `scope` is the live instance; `signal` aborts on `$destroy`; `onCleanup`
 * registers teardown scoped to the current invocation. The factory runs
 * **per invocation** (treat its body as the action's prologue, not
 * per-instance setup — per-instance state belongs in scope fields).
 *
 * Action names must not collide with existing fields, derivations,
 * `$`-methods, prior middleware members, or other actions, and must not
 * start with `$` (reserved). Violations throw on `create()`.
 *
 * @example
 * ```ts
 * const counter = withActions(
 *   valueScope({ count: value(0) }),
 *   { inc: ({ scope }) => (by: number) => scope.count.set(scope.count.get() + by) },
 *   { reset: ({ scope }) => () => scope.inc(-scope.count.get()) }, // calls inc
 * );
 * const c = counter.create();
 * c.inc(3);
 * c.reset();
 * ```
 */
export function withActions(
	template: ScopeTemplate,
	...layers: Array<Record<string, RuntimeFactory>>
): AugmentedScopeTemplate<Record<string, unknown>, unknown> {
	// Flatten the layers once — the structure is static, so there's no need to
	// re-walk it with Object.entries/Object.keys on every create()/destroy().
	const entries: Array<[string, RuntimeFactory]> = [];
	for (const layer of layers) {
		for (const entry of Object.entries(layer)) entries.push(entry);
	}
	const names = entries.map(([name]) => name);

	return asUnknownValueScope(template).extendConfig({
		onCreate({ scope, signal }) {
			// One abort listener per instance, shared by every in-flight call.
			const pending = new Set<() => void>();
			signal.addEventListener(
				'abort',
				() => {
					// Snapshot: a cleanup must not affect which calls this abort
					// flushes (e.g. if it starts a new action).
					// eslint-disable-next-line unicorn/no-useless-spread
					for (const run of [...pending]) run();
					pending.clear();
				},
				{ once: true },
			);
			for (const [name, factory] of entries) {
				if (name.startsWith('$')) {
					throw new Error(
						`withActions: action "${name}" must not start with "$" — that namespace is reserved for framework and middleware methods.`,
					);
				}
				// hasOwnProperty, not `in`: real fields/derivations/$-methods/
				// augmentations are own props, so this catches genuine
				// collisions without rejecting names that merely shadow
				// Object.prototype (e.g. an action named `toString`).
				if (Object.prototype.hasOwnProperty.call(scope, name)) {
					throw new Error(
						`withActions: action "${name}" collides with an existing field, derivation, $-method, or another action.`,
					);
				}
				scope[name] = makeAction(factory, scope, signal, pending);
			}
		},
		onDestroy({ scope }) {
			for (const name of names) {
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete scope[name];
			}
		},
	});
}
