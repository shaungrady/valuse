import { asyncDelay } from './asyncDelay.js';

interface AsyncPollOptions {
	/** Interval in milliseconds between polls. */
	ms: number;
	/** AbortSignal — stops polling when fired. */
	signal: AbortSignal;
}

/** Signal-aware polling loop. Calls `fn` immediately, then every `ms` milliseconds until aborted. */
export const asyncPoll = async (
	{ ms, signal }: AsyncPollOptions,
	fn: () => void | Promise<void>,
): Promise<void> => {
	while (!signal.aborted) {
		await fn();
		await asyncDelay({ ms, signal }).catch(() => {});
	}
};
