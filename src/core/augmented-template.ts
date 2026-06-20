import type { ScopeTemplate } from './value-scope.js';
import type { ScopeMap } from './scope-map.js';
import type { ScopeInstance, ValueInputOf } from './scope-types.js';

/**
 * A {@link ScopeTemplate} whose instances carry extra members `Ext` beyond
 * the base {@link ScopeInstance}. Middleware that attaches per-instance
 * methods (e.g. `withHistory`'s undo/redo) returns one of these so the
 * added surface is typed on `create()` and `createMap()` entries.
 *
 * @remarks
 * Because it extends `ScopeTemplate<Def>`, augmented templates stay
 * assignable to the base and flow through downstream middleware
 * (`withPersistence`/`withDevtools` preserve them via `<T extends
 * ScopeTemplate<any>> => T` passthrough).
 *
 * The composition payoff comes when a middleware is **generic over an
 * incoming `Ext`**: taking `AugmentedScopeTemplate<Def, InExt>` and
 * returning `AugmentedScopeTemplate<Def, InExt & NewMembers>` makes a
 * stack of middleware **accumulate** their augmentations instead of each
 * one dropping the previous. This is what lets, say,
 * `withHistory(withActions(template, …))` produce instances that carry
 * both the actions and `$undo`/`$redo`, fully typed.
 *
 * @typeParam Def - the scope definition record.
 * @typeParam Ext - extra instance members contributed by middleware.
 *
 * @example
 * ```ts
 * // A middleware that adds a typed `$reset` to every instance:
 * function withReset<Def extends Record<string, unknown>, InExt = unknown>(
 *   template: AugmentedScopeTemplate<Def, InExt>,
 * ): AugmentedScopeTemplate<Def, InExt & { $reset: () => void }> {
 *   // ...attach $reset in onCreate...
 *   return template as never;
 * }
 * ```
 */
export interface AugmentedScopeTemplate<
	Def extends Record<string, unknown>,
	Ext,
> extends ScopeTemplate<Def> {
	create(input?: Partial<ValueInputOf<Def>>): ScopeInstance<Def> & Ext;
	createMap<K extends string | number = string | number>(): ScopeMap<
		K,
		Def,
		ScopeInstance<Def> & Ext
	>;
	createMap<K extends string | number>(
		data: Partial<ValueInputOf<Def>>[],
		keyFieldOrFn:
			| (keyof ValueInputOf<Def> & string)
			| ((item: Partial<ValueInputOf<Def>>) => K),
	): ScopeMap<K, Def, ScopeInstance<Def> & Ext>;
	createMap<K extends string | number>(
		data:
			| Map<K, Partial<ValueInputOf<Def>>>
			| [K, Partial<ValueInputOf<Def>>][],
	): ScopeMap<K, Def, ScopeInstance<Def> & Ext>;
}
