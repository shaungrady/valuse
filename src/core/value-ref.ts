import { Value } from './value.js';
import { ValueSet } from './value-set.js';
import { ValueMap } from './value-map.js';

/**
 * The runtime field type a `valueRef` becomes on a scope instance.
 *
 * {@link valueScope} resolves the ref when an instance is built and attaches
 * the underlying source directly to the instance. For factory refs
 * (`valueRef(() => createSomething())`) the field is the factory's return
 * type; for non-factory refs the field is the source itself.
 *
 * @typeParam TSource - the source type passed to `valueRef()`.
 */
export type ResolvedRef<TSource> = TSource extends () => infer R ? R : TSource;

/**
 * What `valueRef(source).get()` returns. Mirrors the resolution logic in
 * `createRefFromSource`:
 *
 * - `Value<In, Out>` → `Out`
 * - `ValueSet<T>` → `Set<T>`
 * - `ValueMap<K, V>` → `Map<K, V>`
 * - anything with `$get()` (scope instance) → its `$get()` result
 * - anything with `.get()` → its `.get()` result
 * - factory `() => T` → `T`
 * - otherwise → the source itself
 *
 * @typeParam TSource - the source type passed to `valueRef()`.
 */
export type RefValue<TSource> =
	TSource extends Value<unknown, infer Out> ? Out
	: TSource extends ValueSet<infer T> ? Set<T>
	: TSource extends ValueMap<infer K, infer V> ? Map<K, V>
	: TSource extends { $get(): infer R } ? R
	: TSource extends { get(): infer R } ? R
	: TSource extends () => infer R ? R
	: TSource;

/**
 * A read-only reference to an external reactive source.
 * Used inside scope definitions to share state across instances.
 *
 * @remarks
 * A `ValueRef` allows a scope to read from an external reactive source (like
 * a {@link Value}, {@link ValueSet}, or another scope instance) without
 * copying the state. Every instance of the scope will read from the same
 * underlying source (or, for factory refs, get its own per-instance source).
 *
 * On a scope instance, the field is **not** a `ValueRef` wrapper — it is the
 * resolved source directly. Use the {@link ResolvedRef} helper to compute
 * the instance field type from a source type.
 *
 * @typeParam TSource - the source type passed to `valueRef()`.
 *
 * @see {@link valueRef} factory function for creating instances.
 */
export class ValueRef<TSource> {
	readonly #getter: () => unknown;
	/** The original source object. @internal */
	readonly source: TSource;
	/** Factory function for per-instance sources. @internal */
	readonly factory: (() => unknown) | undefined;

	/** @internal */
	constructor(
		getter: () => unknown,
		source?: TSource,
		factory?: () => unknown,
	) {
		this.#getter = getter;
		this.source = source as TSource;
		this.factory = factory;
	}

	/**
	 * Read the referenced value.
	 *
	 * For factory refs, `.get()` on the standalone ref returns `undefined`
	 * because the factory only runs per-scope-instance. Access the resolved
	 * value via `scope.<field>` on an instance.
	 *
	 * @returns the current value from the external source.
	 */
	get(): RefValue<TSource> {
		return this.#getter() as RefValue<TSource>;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyValueRef = ValueRef<any>;

/** Any object with a .get() method (or $get for scope instances). */
interface ReactiveSource<T = unknown> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	get(...args: any[]): T;
}

/** An object with $get() (scope instances). */
interface DollarGetSource<T = unknown> {
	$get(): T;
}

/**
 * Create a ref to a {@link Value}.
 *
 * @param source - the value instance to reference.
 * @returns a ref whose `.get()` returns the value's current output.
 */
export function valueRef<In, Out>(
	source: Value<In, Out>,
): ValueRef<Value<In, Out>>;
/**
 * Create a ref to a {@link ValueSet}.
 *
 * @param source - the value set to reference.
 * @returns a ref whose `.get()` returns the underlying `Set`.
 */
export function valueRef<T>(source: ValueSet<T>): ValueRef<ValueSet<T>>;
/**
 * Create a ref to a {@link ValueMap}.
 *
 * @param source - the value map to reference.
 * @returns a ref whose `.get()` returns the underlying `Map`.
 */
export function valueRef<K extends string | number, V>(
	source: ValueMap<K, V>,
): ValueRef<ValueMap<K, V>>;
/**
 * Create a ref to a scope instance (has `$get()`). The source type is
 * preserved so the instance field is typed as the scope instance itself,
 * letting consumers reach into its fields with the usual `.get()` / `.use()`.
 *
 * @param source - the scope instance to reference.
 * @returns a ref carrying the scope instance's full type.
 */
export function valueRef<S extends DollarGetSource>(source: S): ValueRef<S>;
/**
 * Create a ref to any reactive source with a `.get()` method.
 *
 * @param source - the reactive source to reference.
 * @returns a ref carrying the source's full type.
 */
export function valueRef<S extends ReactiveSource>(source: S): ValueRef<S>;
/**
 * Create a ref from a factory function. Each scope instance calls the factory
 * to get its own source. The instance field is typed as the factory's return.
 *
 * @param factory - a function that returns a reactive source.
 * @returns a ref that will be instantiated per scope instance.
 *
 * @example
 * ```ts
 * const user = valueScope({
 *   preferences: valueRef(() => fetchUserPreferences()),
 * });
 * ```
 */
export function valueRef<T>(factory: () => T): ValueRef<() => T>;
// Implementation
export function valueRef(source: unknown): ValueRef<unknown> {
	if (typeof source === 'function' && !isReactiveSource(source)) {
		return new ValueRef(() => undefined, undefined, source as () => unknown);
	}
	return createRefFromSource(source);
}

/** Create a ValueRef from an already-resolved source. @internal */
function createRefFromSource(source: unknown): ValueRef<unknown> {
	// Scope instances use $get()
	if (
		typeof source === 'object' &&
		source !== null &&
		'$get' in source &&
		typeof (source as DollarGetSource).$get === 'function'
	) {
		const reactive = source as DollarGetSource;
		return new ValueRef(() => reactive.$get(), source);
	}
	// Any object with a .get() method is treated as a reactive source
	if (
		typeof source === 'object' &&
		source !== null &&
		'get' in source &&
		typeof (source as ReactiveSource).get === 'function'
	) {
		const reactive = source as ReactiveSource;
		return new ValueRef(() => reactive.get(), source);
	}
	return new ValueRef(() => source, source);
}

function isReactiveSource(source: unknown): boolean {
	return (
		source instanceof Value ||
		source instanceof ValueSet ||
		source instanceof ValueMap
	);
}
