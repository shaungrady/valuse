import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Throttle pipe: passes the first value immediately, then ignores subsequent
 * values within the `ms` window. The last value in a window is always emitted.
 *
 * @typeParam T - the value type.
 * @param ms - throttle window in milliseconds.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const position = value(0).pipe(pipeThrottle(100));
 * ```
 */
export function pipeThrottle<T>(ms: number): PipeFactoryDescriptor<T, T> {
	return {
		create: ({ set, onCleanup }) => {
			let timer: ReturnType<typeof setTimeout> | null = null;
			let lastValue: T | undefined;
			let hasTrailing = false;

			onCleanup(() => {
				if (timer !== null) clearTimeout(timer);
			});

			return (value: T) => {
				lastValue = value;
				if (timer === null) {
					set(value);
					timer = setTimeout(() => {
						timer = null;
						if (hasTrailing) {
							hasTrailing = false;
							set(lastValue as T);
						}
					}, ms);
				} else {
					hasTrailing = true;
				}
			};
		},
	};
}
