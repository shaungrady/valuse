/**
 * A non-reactive value stored in a scope.
 * Readable via `.get()` but invisible to the reactive graph.
 *
 * @remarks
 * `ValuePlain` is **inert**: writes do not trigger derivations, `$subscribe`
 * callbacks, `onChange` lifecycle hooks, devtools actions, or history
 * entries. This is intentional, plain fields are for instance-scoped data
 * that doesn't drive UI (handles, refs, ids, configuration) where the cost
 * of reactivity isn't worth paying. If you need any of those behaviors,
 * use `value()` instead.
 *
 * @typeParam T - the type of the stored value.
 * @typeParam R - whether the value is readonly after creation.
 *
 * @see {@link valuePlain} factory function for creating instances.
 */
export class ValuePlain<T, R extends boolean = false> {
	/** @internal */
	readonly _value: T;
	/** @internal */
	readonly _readonly: R;
	/** @internal */
	_pipeSteps: Array<{ kind: 'sync'; transform: (v: unknown) => unknown }>;

	/** @internal */
	constructor(value: T, options?: { readonly: R }) {
		this._value = value;
		this._readonly = (options?.readonly ?? false) as R;
		this._pipeSteps = [];
	}

	/**
	 * Add a transform pipe. Returns a new ValuePlain descriptor with the pipe attached.
	 * @param transform - a function that transforms the input value on write.
	 */
	pipe<U>(transform: (value: T) => U): ValuePlain<U, R> {
		// Store the *raw* default — the InstanceStore applies the pipeline at init time
		const next = new ValuePlain<U, R>(
			this._value as unknown as U,
			{
				readonly: this._readonly,
			} as { readonly: R },
		);
		// Copy existing steps and add the new one
		next._pipeSteps.push(...this._pipeSteps, {
			kind: 'sync',
			transform: transform as (v: unknown) => unknown,
		});
		return next;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyValuePlain = ValuePlain<any, boolean>;

/**
 * Create a non-reactive value for use in a scope definition.
 *
 * @param initial - the initial value.
 * @param options - optional configuration.
 * @returns a {@link ValuePlain} instance.
 *
 * @example
 * ```ts
 * const config = valueScope({
 *   apiKey: valuePlain("12345", { readonly: true }),
 *   theme: valuePlain("light"),
 * });
 * ```
 */
export function valuePlain<T>(
	initial: T,
	options: { readonly: true },
): ValuePlain<T, true>;
/**
 * Create a non-reactive value for use in a scope definition.
 *
 * @param initial - the initial value.
 * @returns a {@link ValuePlain} instance.
 */
export function valuePlain<T>(initial: T): ValuePlain<T>;
export function valuePlain<T>(
	initial: T,
	options?: { readonly: boolean },
): ValuePlain<T, boolean> {
	return new ValuePlain(initial, options);
}
