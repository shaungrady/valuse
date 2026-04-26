import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Scan pipe: accumulate values over time, like `Array.reduce`.
 *
 * @typeParam T - the incoming value type.
 * @typeParam Acc - the accumulator type.
 * @param reducer - function that combines the accumulator with each new value.
 * @param initial - the initial accumulator value.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const sum = value(0).pipe(pipeScan((acc, n) => acc + n, 0));
 * sum.set(3);
 * sum.set(7);
 * sum.get(); // 10
 * ```
 */
export function pipeScan<T, Acc>(
	reducer: (accumulator: Acc, value: T) => Acc,
	initial: Acc,
): PipeFactoryDescriptor<T, Acc> {
	return {
		create: ({ set }) => {
			let accumulator = initial;
			return (value: T) => {
				accumulator = reducer(accumulator, value);
				set(accumulator);
			};
		},
	};
}
