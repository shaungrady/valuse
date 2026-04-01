/**
 * A read-only reference to an external reactive source.
 *
 * @remarks
 * Used inside scope definitions to share state across all instances.
 * The source is not copied — every scope instance reads from the same
 * underlying signal via a computed that tracks the source's changes.
 *
 * Two modes:
 * - Reactive sources ({@link Value}, {@link ValueSet}, {@link ValueMap}):
 *   `ref.get()` delegates to `source.get()`
 * - {@link ScopeInstance}: `ref.get()` returns the instance itself — signal tracking
 *   flows transitively through chained `.get()`/`.set()` calls
 */

import { Value } from './value.js';
import { ValueSet } from './value-set.js';
import { ValueMap } from './value-map.js';
import type { ScopeInstance } from './value-scope.js';

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

	/**
	 * @param getter - a function that reads from the external source
	 * @param source - the original source object (for transitive lifecycle)
	 */
	constructor(getter: () => T, source?: unknown) {
		this._get = getter;
		this.source = source;
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

// Implementation
export function valueRef(source: unknown): ValueRef<unknown> {
	// Known reactive sources — delegate to .get() to unwrap the signal value
	if (
		source instanceof Value ||
		source instanceof ValueSet ||
		source instanceof ValueMap
	) {
		const reactive = source as ReactiveSource<unknown>;
		return new ValueRef(() => reactive.get(), source);
	}
	// Everything else (ScopeInstance, etc.) — return the source itself
	return new ValueRef(() => source, source);
}
