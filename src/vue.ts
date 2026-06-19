/**
 * Vue integration entry point for valuse.
 *
 * Re-exports the full core API plus Vue composition-API adapters.
 *
 * @example
 * ```ts
 * import { value, useValuse } from 'valuse/vue';
 * ```
 *
 */
export * from './index.js';
export { useValuse, useValuseModel } from './vue/bridge.js';
