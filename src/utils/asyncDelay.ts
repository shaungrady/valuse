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
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timeout);
				reject(reason());
			},
			{ once: true },
		);
	});
