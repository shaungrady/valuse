/**
 * A non-reactive value stored in a scope.
 *
 * Readable via `get()` but invisible to the reactive graph — reading a plain
 * value inside a derivation or `use()` will not create a dependency and will
 * not trigger re-renders.
 *
 * @typeParam T - the type of the stored value
 * @typeParam R - whether the value is readonly after creation
 *
 * @see {@link valuePlain} factory function for creating instances
 */
export class ValuePlain<T, R extends boolean = false> {
	/** @internal */
	readonly _value: T;
	/** @internal */
	readonly _readonly: R;

	constructor(value: T, options?: { readonly: R }) {
		this._value = value;
		this._readonly = (options?.readonly ?? false) as R;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyValuePlain = ValuePlain<any, boolean>;

/**
 * Create a non-reactive value for use in a scope definition.
 *
 * Plain values are readable via `get()` but do not participate in the
 * reactive graph. Calling `use()` on a plain key is a type error and
 * throws at runtime.
 *
 * @param initial - the initial value
 * @param options - pass `{ readonly: true }` to prevent `set()` after creation
 *
 * @example
 * ```ts
 * const scope = valueScope({
 *   config: valuePlain({ theme: "dark" }, { readonly: true }),
 *   columns: valuePlain(column.createMap()),
 * });
 *
 * inst.get("config");   // { theme: "dark" }
 * inst.get("columns");  // the ScopeMap
 * inst.use("config");   // type error + runtime throw
 * inst.set("config", x) // type error + runtime throw (readonly)
 * inst.set("columns", newMap) // ok (writable)
 * ```
 */
export function valuePlain<T>(
	initial: T,
	options: { readonly: true },
): ValuePlain<T, true>;
export function valuePlain<T>(initial: T): ValuePlain<T>;
export function valuePlain<T>(
	initial: T,
	options?: { readonly: boolean },
): ValuePlain<T, boolean> {
	return new ValuePlain(initial, options);
}
