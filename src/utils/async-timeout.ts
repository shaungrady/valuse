interface AsyncTimeoutOptions {
	/** Maximum time in milliseconds before rejecting. */
	ms: number;
	/** AbortSignal — rejects with abort reason if fired before timeout. */
	signal: AbortSignal;
}

/** Runs `fn` with a time limit. Rejects with a Timeout error if it doesn't resolve in time. */
export const asyncTimeout = async <T>(
	{ ms, signal }: AsyncTimeoutOptions,
	fn: () => T | Promise<T>,
): Promise<T> => {
	if (signal.aborted) throw signal.reason as Error;

	let timer!: ReturnType<typeof setTimeout>;
	let onAbort!: () => void;
	// Rejection-only race partner: fires as soon as the deadline elapses or
	// the caller aborts, so the timeout is enforced even while `fn` is still
	// pending — it does not wait for `fn` to settle first.
	const guard = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new Error('Timeout'));
		}, ms);
		onAbort = () => {
			reject(signal.reason as Error);
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});

	const fnPromise = Promise.resolve(fn());
	// If the guard wins, `fn` keeps running detached; swallow any later
	// rejection so it doesn't surface as an unhandled rejection.
	void fnPromise.catch(() => {});

	try {
		return await Promise.race([fnPromise, guard]);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
};
