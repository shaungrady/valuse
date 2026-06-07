import type { PipeFactoryDescriptor } from '../core/types.js';
import { createDeferral } from '../core/utils/deferral.js';

/**
 * Context passed to a {@link createSwitchPipe} handler. Mirrors an async
 * derivation's context: `deferBy` is inline, `signal` aborts on the next
 * write (or host destroy), `set` commits downstream.
 *
 * @typeParam In - the incoming value type.
 * @typeParam Out - the committed value type.
 */
export interface SwitchContext<In, Out> {
	/** The value for this write. */
	value: In;
	/** Commit a value downstream. */
	set: (value: Out) => void;
	/** Abortable + flushable sleep. Rejects when this write is superseded. */
	deferBy: (ms: number) => Promise<void>;
	/** Aborts when a NEW write arrives, or when the host is destroyed. */
	signal: AbortSignal;
	/** Cleanup for this write — runs on supersede or host destroy. */
	onCleanup: (fn: () => void) => void;
}

/**
 * Build a "switch" factory pipe: cancel-and-replace semantics. Each write
 * runs `handler`; a new write aborts the prior handler's `signal`
 * (including any `fetch` after a `deferBy`), so only the latest write
 * commits. Used for debounce and async-lookup pipes.
 *
 * @typeParam In - the incoming value type.
 * @typeParam Out - the committed value type.
 * @param handler - per-write handler; reads like an async derivation.
 * @returns a {@link PipeFactoryDescriptor}.
 *
 * @example
 * ```ts
 * const pipeDebounce = (ms: number) =>
 *   createSwitchPipe<string, string>(async ({ value, set, deferBy }) => {
 *     await deferBy(ms);
 *     set(value);
 *   });
 * ```
 */
export function createSwitchPipe<In, Out>(
	handler: (context: SwitchContext<In, Out>) => void | Promise<void>,
): PipeFactoryDescriptor<In, Out> {
	return {
		create: (host) => {
			let writeController: AbortController | null = null;
			let removeHostListener: (() => void) | null = null;
			let activeDeferral: ReturnType<typeof createDeferral> | null = null;
			let pending: Promise<void> | null = null;

			const abortPrior = (): void => {
				removeHostListener?.();
				removeHostListener = null;
				writeController?.abort();
				writeController = null;
				activeDeferral = null;
			};

			return {
				onWrite(value) {
					abortPrior();

					const controller = new AbortController();
					writeController = controller;

					// Combine with the host's destroy signal.
					if (host.signal.aborted) {
						controller.abort(host.signal.reason);
					} else {
						const onHostAbort = (): void => {
							controller.abort(host.signal.reason);
						};
						host.signal.addEventListener('abort', onHostAbort, {
							once: true,
						});
						removeHostListener = () => {
							host.signal.removeEventListener('abort', onHostAbort);
						};
					}

					const deferral = createDeferral(controller.signal);
					activeDeferral = deferral;
					const cleanups: (() => void)[] = [];

					const run = Promise.resolve(
						handler({
							value,
							set: (output) => {
								// Drop commits from a superseded handler. A newer write
								// aborts this controller; without this guard an async step
								// that ignores the signal (e.g. a fetch that resolves after
								// abort) would still commit its stale value downstream.
								if (controller.signal.aborted) return;
								host.set(output);
							},
							deferBy: (ms) => deferral.deferBy(ms),
							signal: controller.signal,
							onCleanup: (fn) => {
								cleanups.push(fn);
							},
						}),
					);

					pending = run
						.catch((error: unknown) => {
							// Swallow the abort that supersedes this write; surface
							// genuine handler errors.
							if (!controller.signal.aborted) throw error;
						})
						.finally(() => {
							for (const cleanup of cleanups) cleanup();
							if (writeController === controller) {
								pending = null;
								activeDeferral = null;
								writeController = null;
								removeHostListener?.();
								removeHostListener = null;
							}
						});
				},
				get pendingPromise() {
					return pending;
				},
				flush() {
					activeDeferral?.flush();
				},
			};
		},
	};
}
