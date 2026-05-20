import { asyncDelay } from './async-delay.js';

interface AsyncRetryOptions {
	/** Maximum number of attempts (including the first). Default: 3. */
	max?: number;
	/** Base delay in ms between attempts. Multiplied by attempt number. Default: 1000. */
	backoff?: number;
	/** AbortSignal — aborts retry loop when fired. */
	signal: AbortSignal;
}

/** Retries `fn` on failure with linear backoff. Returns the first successful result. */
export const asyncRetry = async <T>(
	{ max = 3, backoff = 1000, signal }: AsyncRetryOptions,
	fn: () => T | Promise<T>,
): Promise<T> => {
	// A pre-aborted signal must not invoke `fn` at all — otherwise we'd
	// either run user side effects after cancellation or, worse, return a
	// success that the caller asked us to abandon.
	signal.throwIfAborted();
	let lastError: unknown;
	for (let attempt = 0; attempt < max; attempt++) {
		try {
			return await fn();
		} catch (error) {
			// Stop retrying when the consumer aborts. Throw the abort reason so
			// callers can distinguish cancellation from the function's own errors.
			signal.throwIfAborted();
			lastError = error;
			if (attempt < max - 1) {
				await asyncDelay({ ms: backoff * (attempt + 1), signal });
			}
		}
	}
	throw lastError;
};
