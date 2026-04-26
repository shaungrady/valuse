import { batch } from '@preact/signals-core';

/**
 * Re-exports from `@preact/signals-core`. Centralizes the signals dependency
 * so the rest of the codebase imports from here rather than the package directly.
 *
 * @internal
 */
export { signal, computed, effect, batch } from '@preact/signals-core';
export type { Signal, ReadonlySignal } from '@preact/signals-core';

/**
 * Group multiple `.set()` calls so subscribers fire once.
 *
 * @example
 * ```ts
 * batchSets(() => {
 *   name.set('Bob');
 *   count.set(42);
 * });
 * // Subscribers notified once, not twice
 * ```
 */
export const batchSets = batch;
