import { effect } from '../signal.js';
import type { Unsubscribe } from '../types.js';

// Shared subscribe-via-effect helpers. All `.subscribe()` methods in the
// codebase share the same skeleton: open an `effect`, skip the first run (so
// callbacks only fire on *changes*, not on initial registration), then call
// the user fn inside a try/catch so a throwing subscriber can't propagate out
// of the source `.set()` via Preact's endBatch. Extracted here to keep that
// contract enforced in one place.

/**
 * Subscribe to a signal-backed value, receiving `(current, previous)` on
 * each change after registration. The first effect run is skipped so the
 * callback only fires on changes.
 *
 * The returned unsubscribe disposes the underlying effect. Callers that need
 * to track the disposer (e.g. for batch cleanup) or wrap with additional
 * lifecycle bookkeeping should compose around the returned function.
 *
 * @internal
 */
export function subscribeWithPrevious<T>(
	read: () => T,
	peek: () => T,
	fn: (value: T, previous: T) => void,
): Unsubscribe {
	let isFirstRun = true;
	let previousValue = peek();
	return effect(() => {
		const currentValue = read();
		if (isFirstRun) {
			isFirstRun = false;
			return;
		}
		const prev = previousValue;
		previousValue = currentValue;
		try {
			fn(currentValue, prev);
		} catch (error) {
			console.error('valuse: subscriber threw', error);
		}
	});
}

/**
 * Subscribe to one or more signals for fire-only notifications (no value or
 * previous-value tracking). The `track` callback runs inside the effect; it
 * should touch (`.value`) every signal whose changes should trigger `fn`.
 * The first effect run is skipped so `fn` only fires on changes.
 *
 * @internal
 */
export function subscribeFireOnly(
	track: () => void,
	fn: () => void,
): Unsubscribe {
	let isFirstRun = true;
	return effect(() => {
		track();
		if (isFirstRun) {
			isFirstRun = false;
			return;
		}
		try {
			fn();
		} catch (error) {
			console.error('valuse: subscriber threw', error);
		}
	});
}
