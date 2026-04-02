/**
 * A read-only reference to an external reactive source.
 *
 * @remarks
 * Used inside scope definitions to share state across all instances.
 * The source is not copied — every scope instance reads from the same
 * underlying signal via a computed that tracks the source's changes.
 *
 * Three modes:
 * - Reactive sources ({@link Value}, {@link ValueSet}, {@link ValueMap}):
 *   `ref.get()` delegates to `source.get()`
 * - {@link ScopeInstance}: `ref.get()` returns the instance itself — signal tracking
 *   flows transitively through chained `.get()`/`.set()` calls
 * - Factory function: each scope instance calls the factory to get its own source
 */

import { Value } from './value.js';
import { ValueSet } from './value-set.js';
import { ValueMap } from './value-map.js';
import { ScopeMap } from './scope-map.js';
import type { ScopeInstance, ScopeEntry } from './value-scope.js';

/**
 * A read-only reactive reference. Used in scope definitions to declare
 * a field that reads from an external source without copying it.
 *
 * @typeParam T - the type returned by `.get()`
 *
 * @see {@link valueRef} factory function for creating instances
 */
export class ValueRef<T> {
	private _get: () => T;
	/** The original source object passed to `valueRef()`. @internal */
	readonly source: unknown;
	/** Factory function for per-instance sources. @internal */
	readonly factory: (() => unknown) | undefined;

	/**
	 * @param getter - a function that reads from the external source
	 * @param source - the original source object (for transitive lifecycle)
	 * @param factory - optional factory function for per-instance sources
	 */
	constructor(getter: () => T, source?: unknown, factory?: () => unknown) {
		this._get = getter;
		this.source = source;
		this.factory = factory;
	}

	/**
	 * Read the referenced value.
	 * @returns the current value from the external source
	 */
	get(): T {
		return this._get();
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyValueRef = ValueRef<any>;

// Any object with a no-arg .get() is a valid reactive source.
interface ReactiveSource<T> {
	get(): T;
}

// --- Factory overloads ---

// ScopeInstance: ref returns the instance itself for chained .get()/.set()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScopeEntry = Value<any> | AnyValueRef | ((...args: any[]) => any);

/**
 * Create a ref to a scope instance. `.get()` returns the instance itself
 * for chained field access.
 *
 * @param source - the scope instance to reference
 * @returns a ref whose `.get()` returns the instance
 *
 * @example
 * ```ts
 * const sharedAddress = address.create({ street: "123 Main" });
 * const person = valueScope({
 *   address: valueRef(sharedAddress),
 * });
 * person.create().get("address").get("street"); // "123 Main"
 * ```
 */
export function valueRef<Def extends Record<string, AnyScopeEntry>>(
	source: ScopeInstance<Def>,
): ValueRef<ScopeInstance<Def>>;

/**
 * Create a ref to a {@link ScopeMap}. `.get()` returns the map itself.
 * @param source - the ScopeMap to reference
 */
export function valueRef<
	Def extends Record<string, ScopeEntry>,
	K extends string | number,
>(source: ScopeMap<Def, K>): ValueRef<ScopeMap<Def, K>>;

/**
 * Create a ref to a {@link ValueMap}. `.get()` returns the current `Map<K, V>`.
 * @param source - the ValueMap to reference
 */
export function valueRef<K, V>(source: ValueMap<K, V>): ValueRef<Map<K, V>>;

/**
 * Create a ref to a {@link ValueSet}. `.get()` returns the current `Set<T>`.
 * @param source - the ValueSet to reference
 */
export function valueRef<T>(source: ValueSet<T>): ValueRef<Set<T>>;

/**
 * Create a ref to any reactive source with a `.get()` method.
 * @param source - the reactive source to reference
 */
export function valueRef<T>(source: ReactiveSource<T>): ValueRef<T>;

/**
 * Create a ref from a factory function. Each scope instance calls the factory
 * to get its own source. The returned source is wired up as if it were passed
 * directly to `valueRef()`.
 *
 * @param factory - a function that creates the source
 * @returns a ref that will be instantiated per scope instance
 *
 * @example
 * ```ts
 * const board = valueScope({
 *   columns: valueRef(() => column.createMap()),
 * });
 * // Each board.create() gets its own column map
 * ```
 */
// eslint-disable-next-line @typescript-eslint/unified-signatures -- factory has different runtime behavior
export function valueRef<T>(factory: () => T): ValueRef<T>;

// Implementation
export function valueRef(source: unknown): ValueRef<unknown> {
	// Factory function — defer creation to per-instance init
	if (typeof source === 'function' && !isReactiveSource(source)) {
		return new ValueRef(() => undefined, undefined, source as () => unknown);
	}

	return createRefFromSource(source);
}

/** Create a ValueRef from an already-resolved source. @internal */
export function createRefFromSource(source: unknown): ValueRef<unknown> {
	// Known reactive sources — delegate to .get() to unwrap the signal value
	if (
		source instanceof Value ||
		source instanceof ValueSet ||
		source instanceof ValueMap
	) {
		const reactive = source as ReactiveSource<unknown>;
		return new ValueRef(() => reactive.get(), source);
	}
	// ScopeMap / ScopeInstance / everything else — return the source itself
	return new ValueRef(() => source, source);
}

function isReactiveSource(source: unknown): boolean {
	return (
		source instanceof Value ||
		source instanceof ValueSet ||
		source instanceof ValueMap ||
		source instanceof ScopeMap
	);
}
