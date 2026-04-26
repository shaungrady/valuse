import { asyncDelay } from './asyncDelay.js';

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
	let lastError: unknown;
	for (let attempt = 0; attempt < max; attempt++) {
		try {
			return await fn();
		} catch (error) {
			// Stop retrying when the consumer aborts. Throw the abort reason so
			// callers can distinguish cancellation from the function's own errors.
			if (signal.aborted) throw signal.reason;
			lastError = error;
			if (attempt < max - 1) {
				await asyncDelay({ ms: backoff * (attempt + 1), signal });
			}
		}
	}
	throw lastError;
};
