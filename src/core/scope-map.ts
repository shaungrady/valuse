import { ScopeTemplate } from './value-scope.js';
import { signal, type Signal } from './signal.js';
import type { Unsubscribe } from './types.js';
import type { ScopeInstance, ValueInputOf } from './scope-types.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';

/**
 * A keyed collection of scope instances sharing the same definition.
 *
 * @remarks
 * Each entry in a `ScopeMap` is an independent reactive scope instance created from
 * the same template. The key list itself is observable, triggering updates when
 * instances are added or removed.
 *
 * @typeParam K - the key type (defaults to `string | number`).
 * @typeParam Def - the scope definition record.
 *
 * @example
 * ```ts
 * const users = userTemplate.createMap<number>();
 * users.set(1, { name: "Alice" });
 * users.get(1)?.name.get(); // "Alice"
 * ```
 */
export class ScopeMap<
	K extends string | number = string | number,
	Def extends Record<string, unknown> = Record<string, unknown>,
	Instance extends ScopeInstance<Def> = ScopeInstance<Def>,
> {
	readonly #template: ScopeTemplate<Def>;
	readonly #instances = new Map<K, ScopeInstance<Def>>();
	readonly #listeners = new Set<(keys: K[]) => void>();
	readonly #keyVersion: Signal<number> = signal(0);

	/** @internal */
	constructor(template: ScopeTemplate<Def>) {
		this.#template = template;
	}

	/**
	 * Number of instances in the collection.
	 * @returns the count of entries.
	 */
	get size(): number {
		return this.#instances.size;
	}

	/**
	 * Check if a key exists in the collection.
	 * @param key - the key to check.
	 * @returns `true` if the key exists.
	 */
	has(key: K): boolean {
		return this.#instances.has(key);
	}

	/**
	 * Get a scope instance by key.
	 * @param key - the key to look up.
	 * @returns the {@link ScopeInstance}, or `undefined` if not found.
	 */
	get(key: K): Instance | undefined {
		return this.#instances.get(key) as Instance | undefined;
	}

	/**
	 * Add or update an instance.
	 *
	 * @remarks
	 * If the key exists, updates the instance via `$setSnapshot`.
	 * If not, creates a new instance from the template.
	 *
	 * @param key - the key to add or update.
	 * @param data - optional initial or update values for the instance.
	 * @returns the new or existing {@link ScopeInstance}.
	 */
	set(key: K, data?: Partial<ValueInputOf<Def>>): Instance {
		const existing = this.#instances.get(key);
		if (existing) {
			if (data) {
				existing.$setSnapshot(data);
			}
			return existing as Instance;
		}

		const instance = this.#template.create(data);
		this.#instances.set(key, instance);
		this.#notifyListeners();
		return instance as Instance;
	}

	/**
	 * Remove an instance from the collection.
	 * Calls `$destroy()` on the instance before removing it.
	 *
	 * @param key - the key to remove.
	 * @returns `true` if an instance was removed.
	 */
	delete(key: K): boolean {
		const instance = this.#instances.get(key);
		if (!instance) return false;
		instance.$destroy();
		this.#instances.delete(key);
		this.#notifyListeners();
		return true;
	}

	/**
	 * Return all keys as an array.
	 * @returns an array of all keys in the collection.
	 */
	keys(): K[] {
		return [...this.#instances.keys()];
	}

	/**
	 * Return all instances as an array.
	 * @returns an array of all {@link ScopeInstance}s in the collection.
	 */
	values(): Instance[] {
		return [...this.#instances.values()] as Instance[];
	}

	/**
	 * Return all entries as `[key, instance]` tuples.
	 * @returns an array of entries.
	 */
	entries(): [K, Instance][] {
		return [...this.#instances.entries()] as [K, Instance][];
	}

	/**
	 * Remove all instances from the collection.
	 * Calls `$destroy()` on each instance.
	 */
	clear(): void {
		for (const instance of this.#instances.values()) {
			instance.$destroy();
		}
		this.#instances.clear();
		this.#notifyListeners();
	}

	/**
	 * Subscribe to key-list changes (adding or removing instances).
	 *
	 * @remarks
	 * This does not fire when individual fields within an instance change.
	 *
	 * @param fn - callback called with the new list of keys.
	 * @returns an {@link Unsubscribe} function.
	 */
	subscribe(fn: (keys: K[]) => void): Unsubscribe {
		this.#listeners.add(fn);
		return () => {
			this.#listeners.delete(fn);
		};
	}

	/**
	 * React hook. Returns the current list of keys.
	 * Re-renders the component when instances are added or removed.
	 *
	 * @returns an array of keys.
	 */
	useKeys(): K[] {
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return this.keys();
	}

	/**
	 * Register a dependency on the key list for the enclosing Preact computed.
	 * Used by the derivation-scope ref wrapper so `scope.<mapRef>.use()` inside
	 * a sync derivation re-runs when keys are added, removed, or cleared.
	 * @internal
	 */
	_trackKeys(): void {
		void this.#keyVersion.value;
	}

	/**
	 * Register a dependency on the key list AND every member's fields for the
	 * enclosing Preact computed. Used by the derivation-scope ref wrapper so
	 * `scope.<mapRef>.use()` inside a sync derivation re-runs on membership
	 * changes and on any field change within any member, mirroring how an
	 * instance ref's `_trackAll()` tracks all of one instance's fields.
	 *
	 * Coarse by design (comparison and aggregation generally depend on every
	 * member) and pull-based, so members added later are tracked on the next
	 * re-run without re-subscription.
	 * @internal
	 */
	_trackAll(): void {
		void this.#keyVersion.value;
		for (const instance of this.#instances.values()) {
			(
				instance as ScopeInstance<Def> & { _trackAll?: () => void }
			)._trackAll?.();
		}
	}

	/**
	 * Subscribe to membership changes AND any field change within any member.
	 * Used by the async derivation ref wrapper, which is push-based and so
	 * cannot re-collect dependencies on each run the way the sync path does.
	 * Member subscriptions are reconciled whenever membership changes, and all
	 * of them are torn down when the returned {@link Unsubscribe} runs.
	 * @internal
	 */
	_subscribeDeep(fn: () => void): Unsubscribe {
		const memberUnsubscribes = new Map<K, Unsubscribe>();
		const reconcile = (): void => {
			for (const [key, instance] of this.#instances) {
				if (!memberUnsubscribes.has(key)) {
					memberUnsubscribes.set(key, instance.$subscribe(fn));
				}
			}
			for (const [key, unsubscribe] of memberUnsubscribes) {
				if (!this.#instances.has(key)) {
					unsubscribe();
					memberUnsubscribes.delete(key);
				}
			}
		};
		reconcile();
		const membershipUnsubscribe = this.subscribe(() => {
			reconcile();
			fn();
		});
		return () => {
			membershipUnsubscribe();
			for (const unsubscribe of memberUnsubscribes.values()) unsubscribe();
			memberUnsubscribes.clear();
		};
	}

	#notifyListeners(): void {
		this.#keyVersion.value++;
		// `keys` is only consumed by direct `#listeners`; the React bridge tracks
		// `#keyVersion` above. Skip building the key array (and the listener
		// snapshot) when nothing is directly subscribed — without this, bulk
		// population via `createMap` (one `set` per item) rebuilds a growing key
		// array on every insert, making construction O(n^2) in allocation.
		if (this.#listeners.size === 0) return;
		const keys = this.keys();
		// Snapshot listeners before iterating: a listener may subscribe again
		// while running (e.g. an async derivation re-subscribing during its
		// re-run), and Set iteration would otherwise pick up that newly added
		// listener and call it within the same notify, causing infinite
		// re-entrance.
		const snapshot = [...this.#listeners];
		for (const listener of snapshot) {
			listener(keys);
		}
	}
}
