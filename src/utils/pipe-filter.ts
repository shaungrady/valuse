import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Filter pipe: only passes values that match the predicate.
 * Values that fail the predicate are silently dropped.
 *
 * @typeParam T - the value type.
 * @param predicate - return `true` to accept the value.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const positive = value(0).pipe(pipeFilter(n => n > 0));
 * positive.set(-1); // ignored
 * positive.set(5);  // accepted
 * ```
 */
export function pipeFilter<T>(
	predicate: (value: T) => boolean,
): PipeFactoryDescriptor<T, T> {
	return {
		create: ({ set }) => {
			return (value: T) => {
				if (predicate(value)) {
					set(value);
				}
			};
		},
	};
}
