import type { Transform } from '../core/types.js';

/**
 * Enum pipe: narrows a value to one of the allowed options.
 * If the incoming value is not in the list, falls back to the first element.
 *
 * @typeParam T - the allowed values (inferred from the array).
 * @param allowed - the list of valid values.
 * @returns a {@link Transform} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const theme = value('light').pipe(pipeEnum(['light', 'dark']));
 * theme.set('dark');   // accepted
 * theme.set('neon');   // falls back to 'light'
 * theme.get();         // 'light'
 * ```
 */
export function pipeEnum<const T extends readonly unknown[]>(
	allowed: T,
): Transform<unknown, T[number]> {
	const set = new Set<unknown>(allowed);
	const fallback = allowed[0] as T[number];
	return (value: unknown): T[number] =>
		set.has(value) ? (value as T[number]) : fallback;
}
