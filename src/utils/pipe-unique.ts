import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Unique pipe: only passes values that differ from the last emitted value.
 * Uses the provided comparator, or strict equality by default.
 *
 * @typeParam T - the value type.
 * @param comparator - optional function returning `true` if two values are equal.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const unique = value("").pipe(pipeUnique());
 * unique.set("a"); // emitted
 * unique.set("a"); // skipped
 * unique.set("b"); // emitted
 * ```
 */
export function pipeUnique<T>(
	comparator?: (a: T, b: T) => boolean,
): PipeFactoryDescriptor<T, T> {
	return {
		create: ({ set }) => {
			let lastValue: T | undefined;
			let hasValue = false;
			const isEqual = comparator ?? ((a: T, b: T) => a === b);

			return (value: T) => {
				if (hasValue && isEqual(lastValue as T, value)) return;
				hasValue = true;
				lastValue = value;
				set(value);
			};
		},
	};
}
