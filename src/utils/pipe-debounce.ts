import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Debounce pipe: delays the value by `ms` milliseconds. Resets on each new value.
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
	return {
		create: ({ set, onCleanup }) => {
			let timer: ReturnType<typeof setTimeout> | null = null;
			onCleanup(() => {
				if (timer !== null) clearTimeout(timer);
			});
			return (value: T) => {
				if (timer !== null) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					set(value);
				}, ms);
			};
		},
	};
}
