/**
 * Svelte integration entry point for valuse.
 *
 * Re-exports the full core API plus Svelte store adapters.
 *
 * @example
 * ```ts
 * import { value, toStore } from 'valuse/svelte';
 * ```
 *
 */
export * from './index.js';
export { toStore, toWritableStore } from './svelte/bridge.js';
