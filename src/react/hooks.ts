/**
 * React integration entry point for valuse.
 *
 * Import `valuse/react` as a side-effect to enable `.use()` hooks
 * on all reactive types (`Value`, `FieldValue`, `ValueArray`, etc.).
 *
 * @example
 * ```ts
 * import 'valuse/react';
 * ```
 *
 * @module
 */
import { useSyncExternalStore } from 'react';
import { installReact } from '../core/react-bridge.js';

installReact({ useSyncExternalStore });
