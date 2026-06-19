/**
 * Angular integration entry point for valuse.
 *
 * Re-exports the full core API plus the Angular signals adapter.
 *
 * @example
 * ```ts
 * import { value, valuseSignal } from 'valuse/angular';
 * ```
 *
 */
export * from './index.js';
export { valuseSignal, type ValuseSignalOptions } from './angular/bridge.js';
