/**
 * Re-exports from `@preact/signals-core`. Centralizes the signals dependency
 * so the rest of the codebase imports from here rather than the package directly.
 *
 * `batchSets` is the public alias for `batch` — group multiple `.set()` calls
 * so subscribers fire once.
 *
 * @example
 * ```ts
 * batchSets(() => {
 *   name.set('Bob');
 *   count.set(42);
 * });
 * // Subscribers notified once, not twice
 * ```
 *
 * @internal
 */
export {
	signal,
	computed,
	effect,
	batch as batchSets,
} from '@preact/signals-core';
export type { Signal, ReadonlySignal } from '@preact/signals-core';
