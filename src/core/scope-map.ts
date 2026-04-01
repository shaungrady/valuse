import {
	ScopeInstance,
	type ScopeConfig,
	type ScopeEntry,
	type ValueKeys,
	type GetType,
	type SetValue,
	type CreateInput,
	type SetInput,
} from './value-scope.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';
import type { Unsubscribe } from './types.js';

/**
 * A keyed collection of scope instances sharing the same definition.
 *
 * Created via {@link ScopeTemplate.createMap | template.createMap()}. Each entry
 * is an independent reactive {@link ScopeInstance}. The key list itself is
 * observable via {@link ScopeMap.subscribe | subscribe()} and
 * {@link ScopeMap.useKeys | useKeys()}.
 *
 * @typeParam Def - the scope definition record
 * @typeParam K - the key type (defaults to `string | number`)
 *
 * @example
 * ```ts
 * const people = person.createMap(new Map([
 *   ["alice", { first: "Alice", last: "Smith" }],
 *   ["bob", { first: "Bob", last: "Jones" }],
 * ]));
 * people.get("alice")?.get("full"); // "Alice Smith"
 * people.set("charlie", { first: "Charlie" });
 * people.keys(); // ["alice", "bob", "charlie"]
 * ```
 *
 * @see {@link ScopeTemplate.createMap} for creation
 * @see {@link ScopeInstance} for the per-instance API
 */
export class ScopeMap<
	Def extends Record<string, ScopeEntry>,
	K extends string | number = string | number,
> {
	private readonly _instances = new Map<K, ScopeInstance<Def>>();
	private readonly _definition: Def;
	private readonly _config: ScopeConfig<Def> | undefined;
	private readonly _listeners = new Set<(keys: K[]) => void>();

	/**
	 * @param definition - the scope definition record
	 * @param config - optional lifecycle hooks for created instances
	 */
	constructor(definition: Def, config?: ScopeConfig<Def>) {
		this._definition = definition;
		this._config = config;
	}

	/**
	 * Number of instances in the collection.
	 * @returns the count of entries
	 */
	get size(): number {
		return this._instances.size;
	}

	/**
	 * Check if a key exists in the collection.
	 * @param key - the key to check for
	 * @returns `true` if the key exists
	 */
	has(key: K): boolean {
		return this._instances.has(key);
	}

	/**
	 * Get a scope instance by key.
	 * @param key - the key to look up
	 * @returns the {@link ScopeInstance}, or `undefined` if not found
	 */
	get(key: K): ScopeInstance<Def> | undefined {
		return this._instances.get(key);
	}

	/**
	 * Add or update an instance. If the key exists, the provided fields
	 * are set on the existing instance. If not, a new instance is created.
	 *
	 * @param key - the key to add or update
	 * @param data - optional initial/update values for writable fields
	 * @returns the new or existing {@link ScopeInstance}
	 *
	 * @example
	 * ```ts
	 * people.set("alice", { first: "Alice", last: "Smith" });
	 * people.set("alice", { first: "Alicia" }); // updates existing
	 * ```
	 */
	set(key: K, data?: CreateInput<Def>): ScopeInstance<Def> {
		const existing = this._instances.get(key);
		if (existing) {
			if (data) {
				for (const [fieldKey, fieldValue] of Object.entries(data)) {
					existing.set(fieldKey as never, fieldValue as never);
				}
			}
			return existing;
		}

		const instance = new ScopeInstance(this._definition, data, this._config);
		this._instances.set(key, instance);
		this._notifyListeners();
		return instance;
	}

	/**
	 * Remove an instance by key. Calls {@link ScopeInstance.destroy | destroy()} on it.
	 * @param key - the key to remove
	 * @returns `true` if the key was found and removed
	 */
	delete(key: K): boolean {
		const instance = this._instances.get(key);
		if (!instance) return false;
		instance.destroy();
		this._instances.delete(key);
		this._notifyListeners();
		return true;
	}

	/**
	 * Return all keys as an array.
	 * @returns an array of all keys in insertion order
	 */
	keys(): K[] {
		return [...this._instances.keys()];
	}

	/**
	 * Return all instances as an array.
	 * @returns an array of all {@link ScopeInstance}s
	 */
	values(): ScopeInstance<Def>[] {
		return [...this._instances.values()];
	}

	/**
	 * Return all entries as `[key, instance]` tuples.
	 * @returns an array of `[K, ScopeInstance]` pairs
	 */
	entries(): [K, ScopeInstance<Def>][] {
		return [...this._instances.entries()];
	}

	/**
	 * Remove all instances. Calls {@link ScopeInstance.destroy | destroy()} on each one.
	 * Notifies key-list subscribers.
	 */
	clear(): void {
		for (const instance of this._instances.values()) {
			instance.destroy();
		}
		this._instances.clear();
		this._notifyListeners();
	}

	/**
	 * Listen for changes to the key list (add/remove).
	 * Does not fire when individual instance fields change.
	 *
	 * @param fn - called with the full key list on each add/remove
	 * @returns an {@link Unsubscribe} function to stop listening
	 *
	 * @example
	 * ```ts
	 * const unsub = people.subscribe((keys) => console.log(keys));
	 * people.set("dave", { first: "Dave" }); // logs ["alice", "bob", "dave"]
	 * unsub();
	 * ```
	 */
	subscribe(fn: (keys: K[]) => void): Unsubscribe {
		this._listeners.add(fn);
		return () => {
			this._listeners.delete(fn);
		};
	}

	/**
	 * React hook — whole instance. Returns `[get, set]` for the instance,
	 * subscribing to all of its fields.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported. Outside React, returns a non-reactive snapshot.
	 *
	 * @param key - the key of the instance to subscribe to
	 * @returns a `[get, set]` tuple with typed accessors
	 *
	 * @example
	 * ```tsx
	 * const [get, set] = people.use("alice");
	 * return <span>{get("full")}</span>;
	 * ```
	 */
	use(key: K): [
		<F extends string & keyof Def>(field: F) => GetType<Def, F>,
		{
			<F extends string & ValueKeys<Def>>(
				field: F,
				value: SetValue<Def, F>,
			): void;
			(values: SetInput<Def>): void;
		},
	];
	/**
	 * React hook — single writable field of an instance. Returns `[value, setter]`.
	 * Only re-renders when this specific field changes.
	 *
	 * @param key - the key of the instance
	 * @param field - the value field to subscribe to
	 * @returns a `[value, setter]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [first, setFirst] = people.use("alice", "first");
	 * ```
	 */
	use<F extends string & ValueKeys<Def>>(
		key: K,
		field: F,
	): [GetType<Def, F>, (value: SetValue<Def, F>) => void];
	/**
	 * React hook — single read-only field of an instance (derivation or ref).
	 * Returns `[value]`. Only re-renders when this specific field changes.
	 *
	 * @param key - the key of the instance
	 * @param field - the derivation or ref field to subscribe to
	 * @returns a `[value]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [fullName] = people.use("alice", "full");
	 * ```
	 */
	use<F extends string & keyof Def>(key: K, field: F): [GetType<Def, F>];
	use(key: K, field?: string): unknown {
		const instance = this._instances.get(key);

		if (field !== undefined) {
			// Per-field subscription — delegate to the instance's per-field use()
			return instance?.use(field as never) ?? [undefined];
		}

		// Whole-instance subscription
		const hooks = getReactHooks();
		if (hooks && instance) {
			const adapter = versionedAdapter(instance, (onChange) =>
				instance.subscribe(() => {
					onChange();
				}),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}

		return [
			(fieldKey: string) => instance?.get(fieldKey as never),
			(keyOrValues: string | Record<string, unknown>, fieldValue?: unknown) => {
				if (typeof keyOrValues === 'object') {
					instance?.set(keyOrValues as SetInput<Def>);
				} else {
					instance?.set(keyOrValues as never, fieldValue as never);
				}
			},
		];
	}

	/**
	 * React hook. Returns the current list of keys.
	 * Re-renders on add/remove, not on individual instance field changes.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported.
	 *
	 * @returns an array of all keys
	 *
	 * @example
	 * ```tsx
	 * const keys = people.useKeys();
	 * // Re-renders when an instance is added or removed
	 * return keys.map((k) => <PersonRow key={k} id={k} />);
	 * ```
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

	/** @internal */
	private _notifyListeners(): void {
		const keys = this.keys();
		for (const listener of this._listeners) {
			listener(keys);
		}
	}
}
