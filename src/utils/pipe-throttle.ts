import type { PipeFactoryDescriptor } from '../core/types.js';

/**
 * Throttle pipe: passes the first value immediately, then ignores
 * subsequent values within the `ms` window. The last value in a window is
 * always emitted (trailing edge). The host value's `.flush()` runs the
 * trailing-edge commit immediately.
 *
 * An accumulating actor: the window survives across writes, so a new write
 * inside the window updates the trailing value rather than restarting.
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
		create: (host) => {
			let inWindow = false;
			let trailing: { value: T } | null = null;
			return {
				onWrite(value) {
					if (inWindow) {
						trailing = { value };
						return;
					}
					host.set(value); // leading edge
					inWindow = true;
					void host.deferBy(ms).then(
						() => {
							if (trailing) {
								host.set(trailing.value); // trailing edge
								trailing = null;
							}
							inWindow = false;
						},
						() => {
							// Window aborted (host destroyed) — drop the trailing value.
						},
					);
				},
			};
		},
	};
}
