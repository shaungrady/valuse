/**
 * Metadata for an async derivation's current state.
 *
 * @typeParam T - the resolved value type.
 *
 * @example
 * ```ts
 * const state = instance.userData.getAsync();
 * if (state.status === 'set') {
 *   console.log('Value:', state.value);
 * } else if (state.status === 'setting') {
 *   console.log('Loading...');
 * } else if (state.status === 'error') {
 *   console.error('Failed:', state.error);
 * }
 * ```
 */
export interface AsyncState<T> {
	/** The current resolved value, or `undefined` if none yet. */
	readonly value: T | undefined;
	/** `true` once any value has been produced (disambiguates intentional `undefined`). */
	readonly hasValue: boolean;
	/**
	 * Current state of the derivation.
	 * - `'unset'` — hasn't started or returned undefined without explicit set()
	 * - `'setting'` — async work in progress
	 * - `'set'` — a value has been produced
	 * - `'error'` — the async function threw or rejected
	 */
	readonly status: 'unset' | 'setting' | 'set' | 'error';
	/** The error if `status === 'error'`, otherwise `undefined`. */
	readonly error: unknown;
}

/** Create the initial async state (before any computation). @internal */
export function initialAsyncState<T>(): AsyncState<T> {
	return {
		value: undefined,
		hasValue: false,
		status: 'unset',
		error: undefined,
	};
}

/** Transition to 'setting' while preserving the previous value. @internal */
export function settingAsyncState<T>(prev: AsyncState<T>): AsyncState<T> {
	return {
		value: prev.value,
		hasValue: prev.hasValue,
		status: 'setting',
		error: undefined,
	};
}

/** Mark a value as resolved. @internal */
export function resolvedAsyncState<T>(value: T): AsyncState<T> {
	return { value, hasValue: true, status: 'set', error: undefined };
}

/** Mark an error, preserving the previous value. @internal */
export function errorAsyncState<T>(
	prev: AsyncState<T>,
	error: unknown,
): AsyncState<T> {
	return {
		value: prev.value,
		hasValue: prev.hasValue,
		status: 'error',
		error,
	};
}
