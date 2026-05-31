import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Batch pipe: collects values and flushes the latest one on the next tick.
 * Synchronous writes within a tick coalesce into a single downstream
 * commit. The host value's `.flush()` commits the pending value
 * immediately.
 *
 * @typeParam T - the value type.
 * @returns a {@link PipeFactoryDescriptor} for use with `.pipe()`.
 *
 * @example
 * ```ts
 * const batched = value(0).pipe(pipeBatch());
 * batched.set(1);
 * batched.set(2);
 * // On the next tick, batched.get() === 2
 * ```
 */
export function pipeBatch<T>(): PipeFactoryDescriptor<T, T> {
	return {
		create: (host) => {
			let pending: { value: T } | null = null;
			let scheduled = false;
			return {
				onWrite(value) {
					pending = { value };
					if (scheduled) return; // a flush is already queued
					scheduled = true;
					void host.deferBy(0).then(
						() => {
							scheduled = false;
							if (pending) {
								host.set(pending.value);
								pending = null;
							}
						},
						() => {
							scheduled = false; // aborted (host destroyed)
						},
					);
				},
			};
		},
	};
}
