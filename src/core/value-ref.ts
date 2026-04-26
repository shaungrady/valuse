import { Value } from './value.js';
import { ValueSet } from './value-set.js';
import { ValueMap } from './value-map.js';

/**
 * A read-only reference to an external reactive source.
 * Used inside scope definitions to share state across instances.
 *
 * @remarks
 * A `ValueRef` allows a scope to read from an external reactive source (like a `Value`,
 * `ValueSet`, or another scope instance) without copying the state. Every instance of
 * the scope will read from the same underlying source.
 *
 * @typeParam T - the type returned by `get()`.
 *
 * @see {@link valueRef} factory function for creating instances.
 */
export class ValueRef<T> {
	readonly #getter: () => T;
	/** The original source object. @internal */
	readonly source: unknown;
	/** Factory function for per-instance sources. @internal */
	readonly factory: (() => unknown) | undefined;

	/** @internal */
	constructor(getter: () => T, source?: unknown, factory?: () => unknown) {
		this.#getter = getter;
		this.source = source;
		this.factory = factory;
	}

	/**
	 * Read the referenced value.
	 * @returns the current value from the external source.
	 */
	get(): T {
		return this.#getter();
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
 * @returns a ref whose `.get()` returns the current output of the value.
 */
export function valueRef<In, Out>(source: Value<In, Out>): ValueRef<Out>;
/**
 * Create a ref to a {@link ValueSet}.
 *
 * @param source - the value set to reference.
 * @returns a ref whose `.get()` returns the underlying `Set`.
 */
export function valueRef<T>(source: ValueSet<T>): ValueRef<Set<T>>;
/**
 * Create a ref to a {@link ValueMap}.
 *
 * @param source - the value map to reference.
 * @returns a ref whose `.get()` returns the underlying `Map`.
 */
export function valueRef<K extends string | number, V>(
	source: ValueMap<K, V>,
): ValueRef<Map<K, V>>;
/**
 * Create a ref to a scope instance (has `$get()`).
 *
 * @param source - the scope instance to reference.
 * @returns a ref whose `.get()` returns the result of the instance's `$get()`.
 */
export function valueRef<T>(source: DollarGetSource<T>): ValueRef<T>;
/**
 * Create a ref to any reactive source with a `.get()` method.
 *
 * @param source - the reactive source to reference.
 * @returns a ref whose `.get()` delegates to the source's `.get()`.
 */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function valueRef<T>(source: ReactiveSource<T>): ValueRef<T>;
/**
 * Create a ref from a factory function. Each scope instance calls the factory
 * to get its own source.
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
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function valueRef<T>(factory: () => T): ValueRef<T>;
// Implementation
export function valueRef(source: unknown): ValueRef<unknown> {
	if (typeof source === 'function' && !isReactiveSource(source)) {
		return new ValueRef(() => undefined, undefined, source as () => unknown);
	}
	return createRefFromSource(source);
}

/** Create a ValueRef from an already-resolved source. @internal */
export function createRefFromSource(source: unknown): ValueRef<unknown> {
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
