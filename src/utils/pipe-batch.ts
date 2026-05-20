import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Batch pipe: collects values and flushes the latest on the next microtask.
 *
 * @typeParam T - the value type.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const batched = value(0).pipe(pipeBatch());
 * batched.set(1);
 * batched.set(2);
 * // On next microtask, batched.get() === 2
 * ```
 */
export function pipeBatch<T>(): PipeFactoryDescriptor<T, T> {
	return {
		create: ({ set }) => {
			let pending: T | undefined;
			let scheduled = false;

			return (value: T) => {
				pending = value;
				if (!scheduled) {
					scheduled = true;
					// eslint-disable-next-line @typescript-eslint/no-floating-promises
					Promise.resolve().then(() => {
						scheduled = false;
						set(pending as T);
					});
				}
			};
		},
	};
}
