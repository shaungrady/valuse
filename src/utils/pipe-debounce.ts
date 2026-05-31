import type { PipeFactoryDescriptor } from '../core/types.js';
import { createSwitchPipe } from './switch-pipe.js';

/**
 * Debounce pipe: delays the value by `ms` milliseconds, resetting on each
 * new value. A new write aborts the pending one (switch semantics), and
 * the host value's `.flush()` commits the pending value immediately.
 *
 * @typeParam T - the value type.
 * @param ms - delay in milliseconds.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const search = value("").pipe(pipeDebounce(300));
 * search.set("he");
 * search.set("hel");
 * search.set("hello");
 * // After 300ms, search.get() === "hello"
 * ```
 */
export function pipeDebounce<T>(ms: number): PipeFactoryDescriptor<T, T> {
	return createSwitchPipe<T, T>(async ({ value, set, deferBy }) => {
		await deferBy(ms);
		set(value);
	});
}
