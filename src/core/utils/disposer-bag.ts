import type { Unsubscribe } from '../types.js';

/**
 * Lifecycle bookkeeping shared by every reactive primitive (Value, ValueArray,
 * ValueMap, ValueSet, ValueSchema). Owns a set of disposers and a single
 * `destroyed` flag, so each class's `.subscribe()` and `.destroy()` collapse to
 * a one-liner and the idempotent-destroy contract lives in one place.
 *
 * @internal
 */
export class DisposerBag {
	readonly #disposers = new Set<() => void>();
	#destroyed = false;

	get destroyed(): boolean {
		return this.#destroyed;
	}

	/**
	 * Track a disposer and return an unsubscribe that disposes + untracks it.
	 * Untracking matters so the bag doesn't hold references to already-disposed
	 * effects once a subscriber unsubscribes.
	 */
	attach(dispose: () => void): Unsubscribe {
		this.#disposers.add(dispose);
		return () => {
			dispose();
			this.#disposers.delete(dispose);
		};
	}

	/**
	 * Run all tracked disposers and mark the bag destroyed. Idempotent: a
	 * second call returns `false` without re-running anything. Returns `true`
	 * on the first call so the caller can run any class-specific extra cleanup
	 * exactly once.
	 */
	destroy(): boolean {
		if (this.#destroyed) return false;
		this.#destroyed = true;
		for (const dispose of this.#disposers) dispose();
		this.#disposers.clear();
		return true;
	}
}
