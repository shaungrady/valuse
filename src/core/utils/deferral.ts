/**
 * A flushable, cancelable, signal-aware timer. The single deferral
 * primitive behind the flush pipeline: `host.deferBy` (actor pipes), the
 * switchable-async-run (`createSwitchPipe` and async-derivation
 * `deferBy`), all compose this.
 *
 * One deferral is active at a time, matching the sequential
 * `await deferBy(...)` usage in a run. Calling `deferBy` while one is
 * already pending supersedes it (the prior rejects); this is defensive,
 * not an expected path.
 *
 * @internal
 */
export interface Deferral {
	/**
	 * Sleep `ms` milliseconds. Resolves normally on timeout, resolves
	 * early if {@link Deferral.flush} is called, rejects if
	 * {@link Deferral.cancel} is called or the parent signal aborts.
	 */
	deferBy(ms: number): Promise<void>;
	/** Resolve the in-flight deferral immediately. No-op when idle. */
	flush(): void;
	/** Reject the in-flight deferral with an AbortError. No-op when idle. */
	cancel(): void;
	/** The in-flight deferral promise, or `null` when idle. */
	readonly pending: Promise<void> | null;
}

interface ActiveDeferral {
	promise: Promise<void>;
	resolve: () => void;
	reject: (reason?: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Create a {@link Deferral} bound to an optional parent `AbortSignal`.
 * When the parent aborts, the in-flight deferral rejects and subsequent
 * `deferBy` calls reject synchronously.
 *
 * @internal
 */
export function createDeferral(parentSignal?: AbortSignal): Deferral {
	let active: ActiveDeferral | null = null;
	// Track the parent-abort subscription so we can detach it on every
	// settle path. Without this, a long-lived `parentSignal` (e.g. an
	// actor's host signal) accumulates one `{ once: true }` listener per
	// `deferBy()` call — they only auto-remove on abort, so a high-
	// frequency throttle/batch leaks listeners for the value's lifetime.
	let removeParentListener: (() => void) | null = null;

	const abortReason = (): unknown =>
		parentSignal?.reason ?? new DOMException('Aborted', 'AbortError');

	const detachParentListener = (): void => {
		removeParentListener?.();
		removeParentListener = null;
	};

	const clearActive = (): ActiveDeferral | null => {
		const current = active;
		if (current) {
			clearTimeout(current.timer);
			active = null;
		}
		detachParentListener();
		return current;
	};

	const onParentAbort = (): void => {
		clearActive()?.reject(abortReason());
	};

	return {
		deferBy(ms: number): Promise<void> {
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- abort reasons are arbitrary (signal.reason is `any`), not necessarily Error
			if (parentSignal?.aborted) return Promise.reject(abortReason());

			// Supersede any in-flight deferral. Sequential use never hits
			// this; it's here so a stray concurrent call can't leak a timer.
			// `clearActive` also detaches the prior parent-abort listener,
			// so we don't double-subscribe below.
			clearActive()?.reject(abortReason());

			let resolve!: () => void;
			let reject!: (reason?: unknown) => void;
			const promise = new Promise<void>((res, rej) => {
				resolve = res;
				reject = rej;
			});
			const timer = setTimeout(() => {
				active = null;
				detachParentListener();
				resolve();
			}, ms);
			active = { promise, resolve, reject, timer };

			// Attach the parent-abort listener only while a deferral is
			// active; detached on every settle path (timer, flush, cancel,
			// supersede). Listener count tracks active deferrals (~1), not
			// total calls.
			if (parentSignal) {
				parentSignal.addEventListener('abort', onParentAbort, {
					once: true,
				});
				removeParentListener = () => {
					parentSignal.removeEventListener('abort', onParentAbort);
				};
			}

			return promise;
		},
		flush(): void {
			clearActive()?.resolve();
		},
		cancel(): void {
			clearActive()?.reject(abortReason());
		},
		get pending(): Promise<void> | null {
			return active?.promise ?? null;
		},
	};
}
