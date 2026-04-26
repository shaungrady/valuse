interface AsyncTimeoutOptions {
	/** Maximum time in milliseconds before rejecting. */
	ms: number;
	/** AbortSignal — rejects with abort reason if fired before timeout. */
	signal: AbortSignal;
}

/** Runs `fn` with a time limit. Rejects with TimeoutError if it doesn't resolve in time. */
export const asyncTimeout = async <T>(
	{ ms, signal }: AsyncTimeoutOptions,
	fn: () => T | Promise<T>,
): Promise<T> => {
	if (signal.aborted) throw signal.reason as Error;
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error('Timeout'));
	}, ms);
	const onAbort = () => {
		controller.abort(signal.reason);
	};
	signal.addEventListener('abort', onAbort, { once: true });
	let result: T;
	try {
		result = await fn();
	} catch (error) {
		clearTimeout(timeout);
		signal.removeEventListener('abort', onAbort);
		if (controller.signal.aborted) throw controller.signal.reason as Error;
		throw error;
	}
	clearTimeout(timeout);
	signal.removeEventListener('abort', onAbort);
	if (controller.signal.aborted) throw controller.signal.reason as Error;
	return result;
};
