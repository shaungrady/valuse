interface AsyncDelayOptions {
	/** Delay in milliseconds. */
	ms: number;
	/** AbortSignal — rejects with abort reason if fired before delay completes. */
	signal: AbortSignal;
}

/** Signal-aware delay. Rejects with AbortError if the signal fires before the delay completes. */
export const asyncDelay = ({ ms, signal }: AsyncDelayOptions): Promise<void> =>
	new Promise((resolve, reject) => {
		const reason = (): Error =>
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			signal.reason || new DOMException('Aborted', 'AbortError');
		if (signal.aborted) {
			reject(reason());
			return;
		}
		// Resolve via the timer on the happy path, but detach the abort
		// listener first. The listener is `{ once: true }`, so it self-removes
		// only when the signal actually fires — on the timeout path it never
		// does. Callers that reuse one long-lived signal across many delays
		// (notably `asyncPoll`, which loops `asyncDelay` with the same signal)
		// would otherwise pile up one listener per call for the signal's
		// lifetime, an unbounded leak.
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(reason());
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
