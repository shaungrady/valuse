import {
	signal,
	computed,
	effect,
	type Signal,
	type ReadonlySignal,
} from './signal.js';
import { Value } from './value.js';
import { ValueRef, createRefFromSource } from './value-ref.js';
import { ValuePlain, type AnyValuePlain } from './value-plain.js';
import { ScopeMap } from './scope-map.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';
import type { AnyValueRef } from './value-ref.js';
import type { Unsubscribe } from './types.js';

/** Prototype for async function detection via instanceof. @internal */

const AsyncFunction = (async () => {}).constructor;
import {
	type AsyncState,
	initialAsyncState,
	syncAsyncState,
	settingAsyncState,
	resolvedAsyncState,
	errorAsyncState,
} from './async-state.js';

// --- Type-level utilities ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = Value<any>;

// --- Derivation context types ---

/** Read a field's value by key. @internal */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldGetter = (key: string) => any;

/** Read a field's async state by key. @internal */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFieldGetter = (key: string) => AsyncState<any>;

/**
 * Context object passed to all derivations (sync and async).
 *
 * @remarks
 * A single type is used for both sync and async derivations to preserve
 * TypeScript contextual typing (separate sync/async function types in a union
 * break parameter inference). Async-only fields (`signal`, `set`, `onCleanup`)
 * are always present on the type but only populated at runtime for async derivations.
 *
 * @example
 * ```ts
 * // Sync derivation — use 'use' and 'get'
 * fullName: ({ use, get }) => {
 *   const first = use('firstName');  // tracked
 *   const fmt = get('format');       // non-tracked peek
 *   return `${first} (${fmt})`;
 * }
 *
 * // Async derivation — additionally use 'signal', 'set', 'onCleanup'
 * user: async ({ use, signal }) => {
 *   const res = await fetch(`/api/users/${use('userId')}`, { signal });
 *   return res.json();
 * }
 * ```
 */
export interface DerivationContext {
	/** Read a field and register it as a reactive dependency. */
	use: FieldGetter;
	/** Read a field without tracking (peek). */
	get: FieldGetter;
	/** Read a field's async metadata without tracking. */
	getAsync: AsyncFieldGetter;
	/** The last value this derivation produced (`undefined` on first run). */
	previousValue: unknown;
	/** AbortSignal — aborted when deps change or instance is destroyed. Only meaningful in async derivations. */
	signal: AbortSignal;
	/** Push an intermediate value before returning. Only meaningful in async derivations. */
	set: (value: unknown) => void;
	/** Register a cleanup callback (runs on abort). Only meaningful in async derivations. */
	onCleanup: (fn: () => void) => void;
}

/** A derivation function in a scope definition. @internal */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DerivationFn = (ctx: DerivationContext) => any;

/** A single entry in a scope definition: a Value, a ValueRef, a ValuePlain, or a derivation function. @internal */
export type ScopeEntry = AnyValue | AnyValueRef | AnyValuePlain | DerivationFn;

/**
 * Extract the keys from a scope definition that are writable {@link Value} fields
 * (not {@link ValueRef} or derivation functions).
 *
 * @typeParam Def - the scope definition record
 *
 * @example
 * ```ts
 * type Keys = ValueKeys<{ name: Value<string>; age: Value<number>; full: (get) => string }>;
 * // "name" | "age"
 * ```
 */
export type ValueKeys<Def> = {
	[K in keyof Def]: Def[K] extends AnyValueRef ? never
	: Def[K] extends ValuePlain<unknown, true> ? never
	: Def[K] extends AnyValuePlain ? K
	: Def[K] extends AnyValue ? K
	: never;
}[keyof Def];

/**
 * Extract the keys from a scope definition that are {@link ValuePlain} fields (any readonlyness).
 * Used to exclude plain keys from `use()`.
 *
 * @typeParam Def - the scope definition record
 */
type PlainKeys<Def> = {
	[K in keyof Def]: Def[K] extends AnyValuePlain ? K : never;
}[keyof Def];

/**
 * Extract the inner type `T` from any scope field entry.
 *
 * - {@link Value}`<T>` → `T`
 * - {@link ValueRef}`<T>` → `T`
 * - Async derivation `(...) => Promise<T>` → `T`
 * - Sync derivation `(...) => R` → `R`
 *
 * @typeParam Entry - a single scope definition entry
 */
type UnwrapFieldType<Entry> =
	Entry extends Value<infer T> ? T
	: Entry extends ValueRef<infer T> ? T
	: Entry extends ValuePlain<infer T, boolean> ? T
	: Entry extends (...args: never[]) => Promise<infer T> ? T
	: Entry extends (...args: never[]) => infer R ? R
	: never;

/**
 * Resolve the runtime type returned by `instance.get(key)` for any key in a scope definition.
 * Async derivations return `T | undefined` (value may not have resolved yet).
 *
 * @typeParam Def - the scope definition record
 * @typeParam K - the key to resolve
 */
export type GetType<Def, K extends keyof Def> =
	Def[K] extends (...args: never[]) => Promise<unknown> ?
		UnwrapFieldType<Def[K]> | undefined
	:	UnwrapFieldType<Def[K]>;

/**
 * Resolve the {@link AsyncState} type for a field.
 * Works for both async derivations and sync fields (sync fields always return a `'set'` state).
 *
 * @typeParam Def - the scope definition record
 * @typeParam K - the key to resolve
 */
export type GetAsyncType<Def, K extends keyof Def> = AsyncState<
	UnwrapFieldType<Def[K]>
>;

/**
 * Extract the keys from a scope definition that are async derivation functions.
 *
 * @typeParam Def - the scope definition record
 */
export type AsyncDerivationKeys<Def> = {
	[K in keyof Def]: Def[K] extends AnyValue ? never
	: Def[K] extends AnyValueRef ? never
	: Def[K] extends (...args: never[]) => Promise<unknown> ? K
	: never;
}[keyof Def];

/**
 * The shape accepted by bulk `.set()`.
 * Only includes writable {@link Value} keys, all optional.
 *
 * @typeParam Def - the scope definition record
 */
export type SetInput<Def> = {
	[K in ValueKeys<Def>]?: Def[K] extends Value<infer T> ?
		undefined extends T ?
			NonNullable<T> | undefined
		:	T
	: Def[K] extends ValuePlain<infer T> ? T
	: never;
};

/**
 * The shape accepted by {@link ScopeInstance} creation.
 * Includes writable {@link Value} keys and async derivation keys (for seeding
 * cached/initial values), all optional.
 *
 * @typeParam Def - the scope definition record
 */
export type CreateInput<Def> = SetInput<Def> & {
	[K in AsyncDerivationKeys<Def>]?: UnwrapFieldType<Def[K]>;
};

/**
 * The type accepted by `instance.set(key, value)` for a writable field.
 * Accepts either a direct value or a `prev => next` updater callback.
 *
 * @typeParam Def - the scope definition record
 * @typeParam K - the value key being set
 */
export type SetValue<Def, K extends ValueKeys<Def>> =
	Def[K] extends Value<infer T> ? T | ((prev: T) => T)
	: Def[K] extends ValuePlain<infer T> ? T | ((prev: T) => T)
	: never;

// --- Change tracking ---

/**
 * A single field change, passed to the {@link ScopeConfig.onChange | onChange} lifecycle hook.
 *
 * @example
 * ```ts
 * onChange: ({ changes }) => {
 *   for (const [key, { from, to }] of changes) {
 *     console.log(`${key}: ${from} → ${to}`);
 *   }
 * }
 * ```
 */
export interface ScopeChange {
	key: string;
	from: unknown;
	to: unknown;
}

/**
 * A map of field changes keyed by field name, passed to the catch-all
 * {@link ScopeConfig.onChange | onChange} handler.
 *
 * Supports `changes.has('fieldName')` for quick checks, iteration via
 * `for (const [key, { from, to }] of changes)`, and `.get('fieldName')`
 * for targeted access.
 *
 * When a field is set multiple times in a single batch, the entry preserves
 * the original `from` and the final `to`.
 */
export type ScopeChanges = ReadonlyMap<string, ScopeChange>;

// --- beforeChange types ---

/**
 * A single pending field change, passed to the {@link ScopeConfig.beforeChange | beforeChange}
 * lifecycle hook. Values are post-pipe, post-comparison (the hook only fires
 * when the value actually differs from the current value).
 */
export interface BeforeChange {
	key: string;
	from: unknown;
	to: unknown;
}

/**
 * A map of pending field changes keyed by field name, passed to the catch-all
 * {@link ScopeConfig.beforeChange | beforeChange} handler.
 *
 * Supports `changes.has('fieldName')`, iteration via
 * `for (const [key, { from, to }] of changes)`, and `.get('fieldName')`.
 */
export type BeforeChanges = ReadonlyMap<string, BeforeChange>;

// --- Scope Config (lifecycle hooks) ---

type ScopeGet<Def> = <K extends string & keyof Def>(key: K) => GetType<Def, K>;
type ScopeSet<Def> = <K extends string & ValueKeys<Def>>(
	key: K,
	value: SetValue<Def, K>,
) => void;

/**
 * Lifecycle hooks and options for a scope.
 *
 * @remarks
 * All hooks receive a context object with typed `get` and `set` helpers.
 * The `set` provided inside hooks bypasses {@link ScopeConfig.onChange | onChange}
 * to avoid infinite loops.
 *
 * @typeParam Def - the scope definition record
 *
 * @example
 * ```ts
 * const user = valueScope(
 *   { name: value(""), email: value("") },
 *   {
 *     onInit: ({ set, input }) => {
 *       if (!input?.name) set("name", "Anonymous");
 *     },
 *     onChange: ({ changes }) => {
 *       console.log("Changed:", [...changes.keys()]);
 *     },
 *   },
 * );
 * ```
 *
 * @see {@link valueScope} factory function
 */
export interface ScopeConfig<Def extends Record<string, ScopeEntry>> {
	/**
	 * When `true`, preserve properties not declared in the scope definition
	 * as plain, non-reactive passthrough data.
	 * @defaultValue `false`
	 */
	allowUndeclaredProperties?: boolean;
	/**
	 * Fires once after the instance is created.
	 * @param ctx - context with `get`, `set`, and the `input` passed to `.create()`
	 */
	onInit?: (ctx: {
		set: ScopeSet<Def>;
		get: ScopeGet<Def>;
		input: CreateInput<Def> | undefined;
	}) => void;
	/**
	 * Fires on a microtask after one or more value fields change. Changes are batched.
	 *
	 * Two forms:
	 * - **Function**: receives all changes in one callback.
	 * - **Object**: per-field handlers, each receiving `{ from, to, get, set }`.
	 *
	 * @example
	 * ```ts
	 * // Catch-all
	 * onChange: ({ changes }) => { ... }
	 *
	 * // Per-field
	 * onChange: {
	 *   data: ({ to, get }) => { ... },
	 *   boardId: ({ to }) => console.log(`Switched to ${to}`),
	 * }
	 * ```
	 */
	onChange?:
		| ((ctx: {
				changes: ScopeChanges;
				set: ScopeSet<Def>;
				get: ScopeGet<Def>;
				getSnapshot: () => Record<string, unknown>;
		  }) => void)
		| {
				[K in string & keyof Def]?: (ctx: {
					from: GetType<Def, K>;
					to: GetType<Def, K>;
					set: ScopeSet<Def>;
					get: ScopeGet<Def>;
				}) => void;
		  };
	/**
	 * Fires synchronously before value fields are written. Can prevent individual
	 * or all changes. Values are post-comparison — the hook only fires when a
	 * real change is about to occur.
	 *
	 * Two forms:
	 * - **Function**: receives all pending changes and a `prevent()` method.
	 *   Call `prevent()` to block all changes, or `prevent('email', 'role')` to
	 *   block specific fields.
	 * - **Object**: per-field handlers, each receiving `{ from, to, prevent }`.
	 *
	 * @example
	 * ```ts
	 * // Catch-all — prevent specific fields
	 * beforeChange: ({ changes, prevent }) => {
	 *   if (changes.has('role') && !isAdmin) prevent('role');
	 * }
	 *
	 * // Per-field
	 * beforeChange: {
	 *   email: ({ to, prevent }) => {
	 *     if (!isValidEmail(to)) prevent();
	 *   },
	 * }
	 * ```
	 */
	beforeChange?:
		| ((ctx: {
				changes: BeforeChanges;
				prevent: (...keys: (string & keyof Def)[]) => void;
				get: ScopeGet<Def>;
		  }) => void)
		| {
				[K in string & keyof Def]?: (ctx: {
					from: GetType<Def, K>;
					to: GetType<Def, K>;
					prevent: () => void;
					get: ScopeGet<Def>;
				}) => void;
		  };
	/**
	 * Fires when the first subscriber attaches (via `.subscribe()` or `.use()`).
	 * @param ctx - context with `get` and `set`
	 */
	onUsed?: (ctx: { set: ScopeSet<Def>; get: ScopeGet<Def> }) => void;
	/**
	 * Fires when the last subscriber detaches.
	 * @param ctx - context with `get`
	 */
	onUnused?: (ctx: { get: ScopeGet<Def> }) => void;
	/**
	 * Fires when `.destroy()` is called on the instance.
	 * @param ctx - context with `get`
	 */
	onDestroy?: (ctx: { get: ScopeGet<Def> }) => void;
}

// --- Scope Instance ---

/**
 * A live instance of a scope — a structured, reactive model.
 *
 * Each instance has its own signal state. Read fields with `.get()`,
 * write with `.set()`, subscribe with `.subscribe()`, and bind to
 * React with `.use()`.
 *
 * @typeParam Def - the scope definition record
 *
 * @example
 * ```ts
 * const person = valueScope({
 *   first: value("Alice"),
 *   last: value("Smith"),
 *   full: (get) => `${get("first")} ${get("last")}`,
 * });
 * const alice = person.create();
 * alice.get("full"); // "Alice Smith"
 * alice.set("first", "Bob");
 * alice.get("full"); // "Bob Smith"
 * ```
 *
 * @see {@link ScopeTemplate} for the factory that creates instances
 * @see {@link ScopeMap} for keyed collections of instances
 */
export class ScopeInstance<Def extends Record<string, ScopeEntry>> {
	private readonly _signals = new Map<string, Signal<unknown>>();
	private readonly _computeds = new Map<string, ReadonlySignal<unknown>>();
	private readonly _asyncStates = new Map<
		string,
		Signal<AsyncState<unknown>>
	>();
	private readonly _asyncControllers = new Map<string, AbortController>();
	private readonly _passthrough = new Map<string, unknown>();
	private readonly _plainKeys = new Set<string>();
	private readonly _readonlyPlainKeys = new Set<string>();
	private readonly _scopeMapKeys = new Set<string>();
	private readonly _config: ScopeConfig<Def> | undefined;
	private readonly _disposers: (() => void)[] = [];
	private _disposed = false;
	private _subscriberCount = 0;
	/** ScopeInstances referenced via valueRef — for transitive lifecycle. @internal */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly _refInstances: ScopeInstance<any>[] = [];
	/** Unsubscribe functions for transitive subscriptions to ref'd instances. @internal */
	private readonly _refUnsubscribes: Unsubscribe[] = [];

	// onChange batching state
	private readonly _pendingChanges = new Map<string, ScopeChange>();
	private _changeBatchScheduled = false;
	private _insideOnChangeHook = false;
	private _insideBeforeChangeHook = false;

	/**
	 * @param definition - the scope definition record
	 * @param input - optional initial values for writable fields
	 * @param config - optional lifecycle hooks and options
	 */
	constructor(
		definition: Def,
		input?: CreateInput<Def>,
		config?: ScopeConfig<Def>,
	) {
		this._config = config;
		const inputObject = input as Record<string, unknown> | undefined;

		// Initialize value signals
		for (const [key, entry] of Object.entries(definition)) {
			if (entry instanceof Value) {
				const hasInput = inputObject !== undefined && key in inputObject;
				const initialValue: unknown = hasInput ? inputObject[key] : entry.get();
				this._signals.set(key, signal(initialValue));
			}
		}

		// Initialize plain (non-reactive) values
		for (const [key, entry] of Object.entries(definition)) {
			if (entry instanceof ValuePlain) {
				this._plainKeys.add(key);
				if (entry._readonly) this._readonlyPlainKeys.add(key);
				const hasInput = inputObject !== undefined && key in inputObject;
				this._passthrough.set(key, hasInput ? inputObject[key] : entry._value);
			}
		}

		// Initialize ref computeds — read from external reactive source
		for (const [key, entry] of Object.entries(definition)) {
			if (entry instanceof ValueRef) {
				// Factory refs create a per-instance source
				const ref =
					entry.factory ? createRefFromSource(entry.factory()) : entry;

				if (ref.source instanceof ScopeMap) {
					// ScopeMap refs: wire key-list changes into a version signal
					// so derivations using use() re-run on add/remove.
					// The map lives in _passthrough, the version signal in _signals.
					// get() and _trackedRead check _scopeMapKeys to return the map.
					const map = ref.source;
					this._scopeMapKeys.add(key);
					this._passthrough.set(key, map);
					const version = signal(0);
					this._signals.set(key, version as Signal<unknown>);
					const unsub = map.subscribe(() => {
						version.value++;
					});
					this._disposers.push(unsub);
				} else {
					this._computeds.set(
						key,
						computed(() => ref.get() as unknown),
					);
				}

				// Track ScopeInstance sources for transitive lifecycle
				if (ref.source instanceof ScopeInstance) {
					this._refInstances.push(ref.source);
				}
			}
		}

		// Initialize derivations
		for (const [key, entry] of Object.entries(definition)) {
			if (typeof entry === 'function' && !(entry instanceof Value)) {
				const isAsync = entry instanceof AsyncFunction;

				if (isAsync) {
					const hasSeed = inputObject !== undefined && key in inputObject;
					this._initAsyncDerivation(
						key,
						entry,
						hasSeed ? inputObject[key] : undefined,
						hasSeed,
					);
				} else {
					this._initSyncDerivation(key, entry);
				}
			}
		}

		// Capture undeclared properties from input
		if (config?.allowUndeclaredProperties && inputObject) {
			for (const key of Object.keys(inputObject)) {
				if (!this._signals.has(key) && !this._computeds.has(key)) {
					this._passthrough.set(key, inputObject[key]);
				}
			}
		}

		// Fire onInit
		if (config?.onInit) {
			config.onInit({
				set: (key, value) => {
					this._setWithoutChangeTracking(key, value);
				},
				get: (key) => this.get(key),
				input,
			});
		}
	}

	/**
	 * Read a field's current value. Works for values, derivations, refs, and passthrough.
	 *
	 * @param key - the field name to read
	 * @returns the current value of the field
	 *
	 * @example
	 * ```ts
	 * const inst = person.create({ first: "Alice" });
	 * inst.get("first"); // "Alice"
	 * inst.get("full");  // "Alice Smith" (derivation)
	 * ```
	 */
	get<K extends string & keyof Def>(key: K): GetType<Def, K>;
	get(key: string): unknown;
	get(key: string): unknown {
		// ScopeMap ref: return the map, not the version signal
		if (this._scopeMapKeys.has(key)) return this._passthrough.get(key);
		const fieldSignal = this._signals.get(key);
		if (fieldSignal) return fieldSignal.value;
		const fieldComputed = this._computeds.get(key);
		if (fieldComputed) return fieldComputed.value;
		if (this._passthrough.has(key)) return this._passthrough.get(key);
		return undefined;
	}

	/**
	 * Read the {@link AsyncState} of a field. For sync fields, this returns a
	 * `'set'` state wrapping the current value. For async derivations, returns
	 * the full status/value/error metadata.
	 *
	 * @param key - the field name to read
	 * @returns the current {@link AsyncState} of the field
	 *
	 * @example
	 * ```ts
	 * const state = scopeInstance.getAsync("profile");
	 * if (state.status === "set") console.log(state.value);
	 * ```
	 */
	getAsync<K extends string & keyof Def>(key: K): GetAsyncType<Def, K>;
	getAsync(key: string): AsyncState<unknown>;
	getAsync(key: string): AsyncState<unknown> {
		return this._readAsyncState(key);
	}

	/**
	 * React hook — subscribe to the {@link AsyncState} of a field.
	 * Returns `[value, asyncState]` and re-renders when the async state changes.
	 *
	 * @param key - the field name to subscribe to
	 * @returns a `[value, asyncState]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [profile, state] = scopeInstance.useAsync("profile");
	 * if (state.status === "setting") return <Spinner />;
	 * ```
	 */
	useAsync<K extends string & Exclude<keyof Def, PlainKeys<Def>>>(
		key: K,
	): [GetType<Def, K>, GetAsyncType<Def, K>];
	useAsync(key: string): [unknown, AsyncState<unknown>];
	useAsync(key: string): [unknown, AsyncState<unknown>] {
		if (this._plainKeys.has(key)) {
			throw new Error(
				`Cannot useAsync() plain value "${key}" — use get() instead`,
			);
		}
		const targetSignal =
			this._asyncStates.get(key) ??
			this._signals.get(key) ??
			this._computeds.get(key);
		if (targetSignal) this._useReactSubscription(targetSignal);

		return [this.get(key as never), this._readAsyncState(key)];
	}

	/**
	 * Write a value field. Accepts a direct value or `prev => next` callback.
	 * Bulk form: pass an object to set multiple fields at once.
	 * Derivation and ref keys are silently ignored.
	 *
	 * @param key - the field name to write
	 * @param valueOrFn - a direct value, or `prev => next` updater
	 *
	 * @example
	 * ```ts
	 * inst.set("first", "Bob");
	 * inst.set("age", (prev) => prev + 1);
	 * inst.set({ first: "Charlie", last: "Brown" });
	 * ```
	 */
	set<K extends string & ValueKeys<Def>>(
		key: K,
		valueOrFn: SetValue<Def, K>,
	): void;
	set(values: SetInput<Def>): void;
	set(keyOrValues: string | SetInput<Def>, valueOrFn?: unknown): void {
		if (typeof keyOrValues === 'object') {
			const pending = new Map<string, BeforeChange>();
			for (const [fieldKey, fieldValue] of Object.entries(keyOrValues)) {
				if (this._readonlyPlainKeys.has(fieldKey)) {
					throw new Error(`Cannot set readonly plain value "${fieldKey}"`);
				}
				if (this._signals.has(fieldKey)) {
					const change = this._resolveChange(fieldKey, fieldValue);
					if (change) pending.set(fieldKey, change);
				} else if (this._plainKeys.has(fieldKey)) {
					this._setPlainField(fieldKey, fieldValue);
				} else if (this._config?.allowUndeclaredProperties) {
					this._passthrough.set(fieldKey, fieldValue);
				}
			}
			this._applyChanges(pending);
			return;
		}
		if (this._readonlyPlainKeys.has(keyOrValues)) {
			throw new Error(`Cannot set readonly plain value "${keyOrValues}"`);
		}
		if (this._plainKeys.has(keyOrValues)) {
			this._setPlainField(keyOrValues, valueOrFn);
			return;
		}
		const change = this._resolveChange(keyOrValues, valueOrFn);
		if (change) {
			const pending = new Map<string, BeforeChange>();
			pending.set(keyOrValues, change);
			this._applyChanges(pending);
		}
	}

	/** Set a plain (non-reactive) field. No change tracking or notifications. @internal */
	private _setPlainField(key: string, valueOrFn: unknown): void {
		const current = this._passthrough.get(key);
		if (typeof valueOrFn === 'function') {
			this._passthrough.set(
				key,
				(valueOrFn as (prev: unknown) => unknown)(current),
			);
		} else {
			this._passthrough.set(key, valueOrFn);
		}
	}

	/**
	 * Resolve a field's next value without writing it.
	 * Returns a BeforeChange if the value actually changed, or null if identical.
	 * @internal
	 */
	private _resolveChange(key: string, valueOrFn: unknown): BeforeChange | null {
		const fieldSignal = this._signals.get(key);
		if (!fieldSignal) return null;

		const previousValue = fieldSignal.value;
		const nextValue =
			typeof valueOrFn === 'function' ?
				(valueOrFn as (prev: unknown) => unknown)(previousValue)
			:	valueOrFn;

		if (nextValue === previousValue) return null;
		return { key, from: previousValue, to: nextValue };
	}

	/**
	 * Run beforeChange, write surviving changes to signals, and batch for onChange.
	 * @internal
	 */
	private _applyChanges(pending: Map<string, BeforeChange>): void {
		if (pending.size === 0) return;

		// Run beforeChange hook — may prevent some or all changes
		if (this._config?.beforeChange && !this._insideBeforeChangeHook) {
			const prevented = new Set<string>();
			const beforeChange = this._config.beforeChange;

			this._insideBeforeChangeHook = true;
			try {
				if (typeof beforeChange === 'function') {
					beforeChange({
						changes: pending as BeforeChanges,
						prevent: (...keys: string[]) => {
							if (keys.length === 0) {
								for (const key of pending.keys()) prevented.add(key);
							} else {
								for (const key of keys) prevented.add(key);
							}
						},
						get: (key) => this.get(key as never),
					});
				} else {
					for (const [, change] of pending) {
						const handler = (
							beforeChange as Record<
								string,
								| ((ctx: {
										from: unknown;
										to: unknown;
										prevent: () => void;
										get: unknown;
								  }) => void)
								| undefined
							>
						)[change.key];
						if (handler) {
							handler({
								from: change.from,
								to: change.to,
								prevent: () => {
									prevented.add(change.key);
								},
								get: (key: string) => this.get(key as never),
							});
						}
					}
				}
			} finally {
				this._insideBeforeChangeHook = false;
			}

			// Remove prevented changes
			for (const key of prevented) pending.delete(key);
		}

		// Write surviving changes to signals and batch for onChange
		for (const [, change] of pending) {
			const fieldSignal = this._signals.get(change.key);
			if (fieldSignal) fieldSignal.value = change.to;

			if (this._config?.onChange && !this._insideOnChangeHook) {
				const existing = this._pendingChanges.get(change.key);
				this._pendingChanges.set(change.key, {
					key: change.key,
					from: existing ? existing.from : change.from,
					to: change.to,
				});
				this._scheduleChangeBatch();
			}
		}
	}

	/**
	 * Listen for changes to a single field. The callback fires with the new and
	 * previous value on each update.
	 *
	 * @param field - the field name to subscribe to
	 * @param fn - called with `(value, previousValue)` on each change
	 * @returns an {@link Unsubscribe} function to stop listening
	 *
	 * @example
	 * ```ts
	 * const unsub = inst.subscribe('email', (value, prev) => {
	 *   console.log(`email: ${prev} → ${value}`);
	 * });
	 * ```
	 */
	subscribe<K extends string & keyof Def>(
		field: K,
		fn: (value: GetType<Def, K>, previousValue: GetType<Def, K>) => void,
	): Unsubscribe;
	/**
	 * Listen for changes to any field. The callback fires after every update.
	 *
	 * @param fn - called with a typed `get` accessor on each change
	 * @returns an {@link Unsubscribe} function to stop listening
	 *
	 * @example
	 * ```ts
	 * const unsub = inst.subscribe((get) => {
	 *   console.log(get("first"), get("full"));
	 * });
	 * ```
	 */
	subscribe(
		fn: (
			get: <K extends string & keyof Def>(key: K) => GetType<Def, K>,
		) => void,
	): Unsubscribe;
	subscribe<K extends string & keyof Def>(
		fieldOrFn:
			| K
			| ((
					get: <F extends string & keyof Def>(key: F) => GetType<Def, F>,
			  ) => void),
		fn?: (value: GetType<Def, K>, previousValue: GetType<Def, K>) => void,
	): Unsubscribe {
		// Per-field subscription
		if (typeof fieldOrFn === 'string') {
			const field = fieldOrFn;
			const fieldFn = fn as (value: unknown, previousValue: unknown) => void;
			const targetSignal =
				this._signals.get(field) ?? this._computeds.get(field);
			if (!targetSignal) return () => {};

			let previousValue = targetSignal.peek();
			let isFirstRun = true;
			const dispose = effect(() => {
				const currentValue = targetSignal.value;
				if (isFirstRun) {
					isFirstRun = false;
					return;
				}
				const prev = previousValue;
				previousValue = currentValue;
				fieldFn(currentValue, prev);
			});

			this._subscriberCount++;
			if (this._subscriberCount === 1) {
				if (this._config?.onUsed) {
					this._config.onUsed({
						set: (key, value) => {
							this._setWithoutChangeTracking(key, value);
						},
						get: (key) => this.get(key),
					});
				}
				for (const refInstance of this._refInstances) {
					const unsub = refInstance.subscribe(() => {});
					this._refUnsubscribes.push(unsub);
				}
			}

			this._disposers.push(dispose);

			return () => {
				dispose();
				this._subscriberCount--;
				if (this._subscriberCount === 0) {
					for (const unsub of this._refUnsubscribes) unsub();
					this._refUnsubscribes.length = 0;
					if (this._config?.onUnused) {
						this._config.onUnused({ get: (key) => this.get(key) });
					}
				}
			};
		}

		// Whole-scope subscription
		const wholeScopeFn = fieldOrFn as (
			get: <K extends string & keyof Def>(key: K) => GetType<Def, K>,
		) => void;
		let isFirstRun = true;
		const dispose = effect(() => {
			// Read every signal and computed to establish tracking for all fields
			this._trackAllSignals();
			// Also track ref'd ScopeInstances so changes propagate transitively
			for (const refInstance of this._refInstances) {
				refInstance._trackAllSignals();
			}

			if (isFirstRun) {
				isFirstRun = false;
				return;
			}

			wholeScopeFn((key) => this.get(key));
		});

		this._subscriberCount++;
		if (this._subscriberCount === 1) {
			// Fire onUsed lifecycle hook
			if (this._config?.onUsed) {
				this._config.onUsed({
					set: (key, value) => {
						this._setWithoutChangeTracking(key, value);
					},
					get: (key) => this.get(key),
				});
			}
			// Transitive: subscribe to ref'd ScopeInstances so their onUsed fires
			for (const refInstance of this._refInstances) {
				const unsub = refInstance.subscribe(() => {});
				this._refUnsubscribes.push(unsub);
			}
		}

		this._disposers.push(dispose);

		return () => {
			dispose();
			this._subscriberCount--;
			if (this._subscriberCount === 0) {
				// Transitive: unsubscribe from ref'd ScopeInstances
				for (const unsub of this._refUnsubscribes) unsub();
				this._refUnsubscribes.length = 0;
				// Fire onUnused lifecycle hook
				if (this._config?.onUnused) {
					this._config.onUnused({ get: (key) => this.get(key) });
				}
			}
		};
	}

	/**
	 * React hook — whole scope. Returns `[get, set]` and subscribes to all fields.
	 * Re-renders the component when any field changes.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported. Outside React, returns a non-reactive snapshot.
	 *
	 * @returns a `[get, set]` tuple with typed accessors
	 *
	 * @example
	 * ```tsx
	 * const [get, set] = inst.use();
	 * return <span>{get("full")}</span>;
	 * ```
	 */
	use(): [
		<K extends string & keyof Def>(key: K) => GetType<Def, K>,
		{
			<K extends string & ValueKeys<Def>>(
				key: K,
				value: SetValue<Def, K>,
			): void;
			(values: SetInput<Def>): void;
		},
	];
	/**
	 * React hook — single writable field. Returns `[value, setter]`.
	 * Only re-renders when this specific field changes.
	 *
	 * @param key - the value field to subscribe to
	 * @returns a `[value, setter]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [first, setFirst] = inst.use("first");
	 * ```
	 */
	use<K extends string & Exclude<ValueKeys<Def>, PlainKeys<Def>>>(
		key: K,
	): [GetType<Def, K>, (value: SetValue<Def, K>) => void];
	/**
	 * React hook — single read-only field (derivation or ref). Returns `[value]`.
	 * Only re-renders when this specific field changes.
	 * Plain keys (`valuePlain`) are not allowed — use `get()` instead.
	 *
	 * @param key - the derivation or ref field to subscribe to
	 * @returns a `[value]` tuple
	 *
	 * @example
	 * ```tsx
	 * const [fullName] = inst.use("full");
	 * ```
	 */
	use<K extends string & Exclude<keyof Def, PlainKeys<Def>>>(
		key: K,
	): [GetType<Def, K>];
	// Implementation
	use(key?: string): unknown {
		if (key !== undefined) {
			if (this._plainKeys.has(key)) {
				throw new Error(
					`Cannot use() plain value "${key}" — use get() instead`,
				);
			}
			// Per-field subscription — subscribe to just this signal/computed
			const targetSignal = this._signals.get(key) ?? this._computeds.get(key);
			if (targetSignal) this._useReactSubscription(targetSignal);

			if (this._signals.has(key)) {
				return [
					this.get(key as never),
					(value: unknown) => {
						this.set(key as never, value as never);
					},
				];
			}
			return [this.get(key as never)];
		}

		// Whole-scope subscription — uses subscribe() rather than a single signal
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return [
			(fieldKey: string) => this.get(fieldKey as never),
			(keyOrValues: string | CreateInput<Def>, value?: unknown) => {
				if (typeof keyOrValues === 'object') {
					this.set(keyOrValues);
				} else {
					this.set(keyOrValues as never, value as never);
				}
			},
		];
	}

	/**
	 * Return a plain object snapshot of the full scope state — values, derivations,
	 * refs, and passthrough fields.
	 *
	 * @returns a plain object with all field values
	 *
	 * @example
	 * ```ts
	 * const snap = inst.getSnapshot();
	 * // { first: "Alice", last: "Smith", full: "Alice Smith" }
	 * ```
	 */
	getSnapshot(): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, fieldSignal] of this._signals) {
			result[key] = fieldSignal.value;
		}
		for (const [key, fieldComputed] of this._computeds) {
			result[key] = fieldComputed.value;
		}
		for (const [key, value] of this._passthrough) {
			result[key] = value;
		}
		return result;
	}

	/**
	 * Full replacement of scope state. Omitted value keys reset to `undefined`.
	 *
	 * @param data - a plain object with the new field values
	 * @param options - set `rerunInit: true` to re-fire the {@link ScopeConfig.onInit | onInit} hook
	 *
	 * @example
	 * ```ts
	 * inst.setSnapshot({ first: "Charlie", last: "Brown" });
	 * inst.setSnapshot(serverData, { rerunInit: true });
	 * ```
	 */
	setSnapshot(
		data: Record<string, unknown>,
		options?: { rerunInit?: boolean },
	): void {
		// Full replacement: every value key not in data resets to undefined
		const pending = new Map<string, BeforeChange>();
		for (const key of this._signals.keys()) {
			const change = this._resolveChange(
				key,
				key in data ? data[key] : undefined,
			);
			if (change) pending.set(key, change);
		}
		this._applyChanges(pending);
		// Passthrough: replace entirely
		if (this._config?.allowUndeclaredProperties) {
			this._passthrough.clear();
			for (const [key, value] of Object.entries(data)) {
				if (!this._signals.has(key) && !this._computeds.has(key)) {
					this._passthrough.set(key, value);
				}
			}
		}
		if (options?.rerunInit && this._config?.onInit) {
			this._config.onInit({
				set: (key, value) => {
					this._setWithoutChangeTracking(key, value);
				},
				get: (key) => this.get(key),
				input: undefined,
			});
		}
	}

	/**
	 * Tear down the instance. Fires {@link ScopeConfig.onDestroy | onDestroy},
	 * then detaches all subscribers. The instance remains readable but inert.
	 */
	destroy(): void {
		if (this._disposed) return;
		this._disposed = true;

		if (this._config?.onDestroy) {
			this._config.onDestroy({ get: (key) => this.get(key) });
		}

		// Abort all in-flight async derivations
		for (const controller of this._asyncControllers.values()) {
			controller.abort();
		}
		this._asyncControllers.clear();

		// Tear down transitive subscriptions to ref'd ScopeInstances
		for (const unsub of this._refUnsubscribes) unsub();
		this._refUnsubscribes.length = 0;

		for (const dispose of this._disposers) dispose();
		this._disposers.length = 0;
	}

	/** Set a field without recording the change for onChange — used by lifecycle hooks. @internal */
	private _setWithoutChangeTracking(key: string, valueOrFn: unknown): void {
		const fieldSignal = this._signals.get(key);
		if (!fieldSignal) return;

		if (typeof valueOrFn === 'function') {
			fieldSignal.value = (valueOrFn as (prev: unknown) => unknown)(
				fieldSignal.value,
			);
		} else {
			fieldSignal.value = valueOrFn;
		}
	}

	private _scheduleChangeBatch(): void {
		if (this._changeBatchScheduled) return;
		this._changeBatchScheduled = true;

		void Promise.resolve().then(() => {
			this._changeBatchScheduled = false;
			if (this._pendingChanges.size === 0 || !this._config?.onChange) return;

			const changes: ScopeChanges = new Map(this._pendingChanges);
			this._pendingChanges.clear();

			const onChange = this._config.onChange;
			const setHelper: typeof this._setWithoutChangeTracking = (key, value) => {
				this._setWithoutChangeTracking(key, value);
			};
			const getHelper = (key: string) => this.get(key as never);

			this._insideOnChangeHook = true;
			try {
				if (typeof onChange === 'function') {
					onChange({
						changes,
						set: setHelper as never,
						get: getHelper as never,
						getSnapshot: () => this.getSnapshot(),
					});
				} else {
					for (const [, change] of changes) {
						const handler = (
							onChange as Record<
								string,
								| ((ctx: {
										from: unknown;
										to: unknown;
										set: unknown;
										get: unknown;
								  }) => void)
								| undefined
							>
						)[change.key];
						if (handler) {
							handler({
								from: change.from,
								to: change.to,
								set: setHelper as never,
								get: getHelper as never,
							});
						}
					}
				}
			} finally {
				this._insideOnChangeHook = false;
			}
		});
	}

	/**
	 * Read all signals and computeds to establish Preact tracking.
	 * Call inside a computed/effect to make it react to any state change in this instance.
	 * @internal
	 */
	_trackAllSignals(): void {
		for (const fieldSignal of this._signals.values()) void fieldSignal.value;
		for (const fieldComputed of this._computeds.values())
			void fieldComputed.value;
		for (const asyncState of this._asyncStates.values()) void asyncState.value;
	}

	/** Read a field's value with Preact tracking (for use inside computed/effect). @internal */
	private _trackedRead(fieldKey: string): unknown {
		if (this._scopeMapKeys.has(fieldKey)) {
			// ScopeMap ref: read version signal for tracking, return map from passthrough
			void this._signals.get(fieldKey)?.value;
			return this._passthrough.get(fieldKey);
		}
		const fieldSignal = this._signals.get(fieldKey);
		if (fieldSignal) return fieldSignal.value;
		const fieldComputed = this._computeds.get(fieldKey);
		if (fieldComputed) return fieldComputed.value;
		if (this._passthrough.has(fieldKey)) return this._passthrough.get(fieldKey);
		return undefined;
	}

	/** Read a field's value without Preact tracking (peek). @internal */
	private _untrackedRead(fieldKey: string): unknown {
		if (this._scopeMapKeys.has(fieldKey))
			return this._passthrough.get(fieldKey);
		const fieldSignal = this._signals.get(fieldKey);
		if (fieldSignal) return fieldSignal.peek();
		const fieldComputed = this._computeds.get(fieldKey);
		if (fieldComputed) return fieldComputed.peek();
		if (this._passthrough.has(fieldKey)) return this._passthrough.get(fieldKey);
		return undefined;
	}

	/** Read a field's async state without tracking. @internal */
	private _readAsyncState(fieldKey: string): AsyncState<unknown> {
		const asyncSignal = this._asyncStates.get(fieldKey);
		if (asyncSignal) return asyncSignal.peek();
		// Sync fields always report as fully resolved
		return syncAsyncState(this._untrackedRead(fieldKey));
	}

	/** Subscribe a React component to a signal/computed via useSyncExternalStore. @internal */
	private _useReactSubscription(
		targetSignal: ReadonlySignal<unknown> | Signal<unknown>,
	): void {
		const hooks = getReactHooks();
		if (!hooks) return;
		const adapter = versionedAdapter(targetSignal, (onChange) => {
			let isFirstRun = true;
			return effect(() => {
				void targetSignal.value;
				if (isFirstRun) {
					isFirstRun = false;
					return;
				}
				onChange();
			});
		});
		hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
	}

	/** Initialize a sync derivation as a Preact computed with context object. @internal */
	private _initSyncDerivation(key: string, derivation: DerivationFn): void {
		let lastValue: unknown = undefined;
		const derivedComputed = computed(() => {
			const ctx: DerivationContext = {
				use: (fieldKey: string) => this._trackedRead(fieldKey),
				get: (fieldKey: string) => this._untrackedRead(fieldKey),
				getAsync: (fieldKey: string) => this._readAsyncState(fieldKey),
				previousValue: lastValue,
				// Sync derivations don't use these — provide no-ops
				signal: AbortSignal.abort(),
				set: () => {},
				onCleanup: () => {},
			};
			const result = derivation(ctx) as unknown;
			// Identity comparison: return same reference to suppress Preact notification
			if (result === lastValue) return lastValue;
			lastValue = result;
			return result;
		});
		this._computeds.set(key, derivedComputed);
	}

	/** Initialize an async derivation with AbortController and effect-based re-run. @internal */
	private _initAsyncDerivation(
		key: string,
		derivation: DerivationFn,
		seedValue?: unknown,
		hasSeed?: boolean,
	): void {
		const asyncStateSignal = signal(
			hasSeed ? resolvedAsyncState(seedValue) : initialAsyncState(),
		);
		this._asyncStates.set(key, asyncStateSignal);

		// Expose the resolved value as a computed so .get(key) works
		const valueComputed = computed(() => asyncStateSignal.value.value);
		this._computeds.set(key, valueComputed);

		let lastValue: unknown = hasSeed ? seedValue : undefined;
		let isFirstRun = true;

		const dispose = effect(() => {
			// Build context — use() calls read .value, establishing Preact tracking.
			// When tracked deps change, Preact re-runs this effect.
			const controller = new AbortController();

			const ctx: DerivationContext = {
				use: (fieldKey: string) => this._trackedRead(fieldKey),
				get: (fieldKey: string) => this._untrackedRead(fieldKey),
				getAsync: (fieldKey: string) => this._readAsyncState(fieldKey),
				previousValue: lastValue,
				signal: controller.signal,
				set: (value: unknown) => {
					if (controller.signal.aborted) return;
					lastValue = value;
					asyncStateSignal.value = resolvedAsyncState(value);
				},
				onCleanup: (fn: () => void) => {
					controller.signal.addEventListener('abort', fn);
				},
			};

			// Abort previous in-flight run
			const prevController = this._asyncControllers.get(key);
			if (prevController) prevController.abort();
			this._asyncControllers.set(key, controller);

			// Transition to 'setting' (preserve previous value if any)
			const prev = asyncStateSignal.peek();
			if (!isFirstRun || prev.status !== 'unset') {
				asyncStateSignal.value = settingAsyncState(prev);
			}
			isFirstRun = false;

			// Run the async derivation — use() calls in the sync preamble
			// (before first await) are tracked. Calls after await are not.
			const promise = derivation(ctx) as Promise<unknown>;
			promise
				.then((result: unknown) => {
					if (controller.signal.aborted) return;
					if (result !== undefined) {
						// Identity comparison — skip if same reference
						if (result === lastValue) {
							if (asyncStateSignal.peek().status !== 'set') {
								asyncStateSignal.value = resolvedAsyncState(lastValue);
							}
							return;
						}
						lastValue = result;
						asyncStateSignal.value = resolvedAsyncState(result);
					} else if (!asyncStateSignal.peek().hasValue) {
						// Return undefined from 'unset'/'setting' with no prior set() → stay unset
						asyncStateSignal.value = initialAsyncState();
					} else {
						// Return undefined but had a prior value → keep value, mark set
						asyncStateSignal.value = resolvedAsyncState(lastValue);
					}
				})
				.catch((error: unknown) => {
					if (controller.signal.aborted) return;
					asyncStateSignal.value = errorAsyncState(prev, error);
				});
		});

		this._disposers.push(dispose);
	}
}

// --- Scope Template ---

/**
 * A reusable scope definition. Call `.create()` to produce instances,
 * `.extend()` to add fields, or `.createMap()` for keyed collections.
 *
 * @typeParam Def - the scope definition record
 *
 * @example
 * ```ts
 * const person = valueScope({
 *   first: value(""),
 *   last: value(""),
 *   full: (get) => `${get("first")} ${get("last")}`,
 * });
 * const alice = person.create({ first: "Alice", last: "Smith" });
 * ```
 *
 * @see {@link valueScope} factory function
 * @see {@link ScopeInstance} for the instance API
 * @see {@link ScopeMap} for keyed collections
 */
export class ScopeTemplate<Def extends Record<string, ScopeEntry>> {
	constructor(
		/** The scope definition record. */
		readonly definition: Def,
		/** Optional lifecycle hooks and options. */
		readonly config?: ScopeConfig<Def>,
	) {}

	/**
	 * Create a new scope instance, optionally providing initial values.
	 *
	 * @param input - optional initial values for writable fields
	 * @returns a new {@link ScopeInstance}
	 *
	 * @example
	 * ```ts
	 * const alice = person.create({ first: "Alice", last: "Smith" });
	 * const anonymous = person.create(); // uses definition defaults
	 * ```
	 */
	create(input?: CreateInput<Def>): ScopeInstance<Def> {
		return new ScopeInstance(this.definition, input, this.config);
	}

	/**
	 * Create a new template with additional fields. Lifecycle hooks are merged
	 * so both base and extension hooks fire in order.
	 *
	 * @typeParam Ext - the extension definition record
	 * @param extension - additional fields to add
	 * @param extensionConfig - optional lifecycle hooks for the extended scope
	 * @returns a new {@link ScopeTemplate} combining base and extension
	 *
	 * @example
	 * ```ts
	 * const employee = person.extend({
	 *   role: value(""),
	 *   title: (get) => `${get("full")} (${get("role")})`,
	 * });
	 * ```
	 */
	extend<Ext extends Record<string, ScopeEntry>>(
		extension: Ext,
		extensionConfig?: ScopeConfig<Def & Ext>,
	): ScopeTemplate<Def & Ext> {
		const mergedDefinition: Def & Ext = { ...this.definition, ...extension };
		const mergedConfig = mergeConfigs<Def & Ext>(
			this.config as ScopeConfig<Def & Ext> | undefined,
			extensionConfig,
		);
		return new ScopeTemplate(mergedDefinition, mergedConfig);
	}

	/**
	 * Create a keyed collection of scope instances.
	 * Optionally seed from a Map, or from an array with a key field/function.
	 *
	 * @remarks
	 * The key type defaults to `string | number`. Narrow it with an explicit
	 * type parameter: `person.createMap<number>()`.
	 *
	 * @typeParam K - the key type (defaults to `string | number`)
	 * @param data - optional initial data as a `Map<K, input>` or array of objects
	 * @param keyOrFn - for array seeding: a property name or `(item) => key` function
	 * @returns a new {@link ScopeMap}
	 *
	 * @example
	 * ```ts
	 * const people = person.createMap(new Map([
	 *   ["alice", { first: "Alice", last: "Smith" }],
	 * ]));
	 *
	 * const fromApi = person.createMap(apiData, "id");
	 * const numbered = person.createMap<number>();
	 * ```
	 */
	createMap<K extends string | number = string | number>(
		data?: Map<K, CreateInput<Def>>,
	): ScopeMap<Def, K>;
	createMap<K extends string | number = string | number>(
		data: Record<string, unknown>[],
		keyOrFn: string | ((item: Record<string, unknown>) => K),
	): ScopeMap<Def, K>;
	createMap<K extends string | number = string | number>(
		data?: Record<string, unknown>[] | Map<K, CreateInput<Def>>,
		keyOrFn?: string | ((item: Record<string, unknown>) => K),
	): ScopeMap<Def, K> {
		const collection = new ScopeMap<Def, K>(this.definition, this.config);

		if (data instanceof Map) {
			for (const [key, input] of data) {
				collection.set(key, input);
			}
		} else if (data && keyOrFn) {
			for (const item of data) {
				const key =
					typeof keyOrFn === 'function' ?
						keyOrFn(item)
					:	(String(item[keyOrFn]) as K);
				collection.set(key, item as CreateInput<Def>);
			}
		}

		return collection;
	}
}

// --- Config merging ---

/**
 * Merge two scope configs, composing lifecycle hooks so both fire in order.
 * @internal
 */
function mergeConfigs<Def extends Record<string, ScopeEntry>>(
	base: ScopeConfig<Def> | undefined,
	extension: ScopeConfig<Def> | undefined,
): ScopeConfig<Def> | undefined {
	if (!base && !extension) return undefined;
	if (!base) return extension;
	if (!extension) return base;

	const merged: ScopeConfig<Def> = {};

	if (base.allowUndeclaredProperties || extension.allowUndeclaredProperties) {
		merged.allowUndeclaredProperties = true;
	}

	if (base.onInit || extension.onInit) {
		merged.onInit = (ctx) => {
			base.onInit?.(ctx);
			extension.onInit?.(ctx);
		};
	}
	if (base.beforeChange || extension.beforeChange) {
		const normalizeBeforeChange = (
			handler: ScopeConfig<Def>['beforeChange'],
		):
			| ((ctx: {
					changes: BeforeChanges;
					prevent: (...keys: string[]) => void;
					get: ScopeGet<Def>;
			  }) => void)
			| undefined => {
			if (!handler) return undefined;
			if (typeof handler === 'function') return handler;
			return (ctx) => {
				for (const [, change] of ctx.changes) {
					const fieldHandler = (
						handler as Record<
							string,
							| ((ctx: {
									from: unknown;
									to: unknown;
									prevent: () => void;
									get: unknown;
							  }) => void)
							| undefined
						>
					)[change.key];
					if (fieldHandler) {
						fieldHandler({
							from: change.from,
							to: change.to,
							prevent: () => {
								ctx.prevent(change.key as never);
							},
							get: ctx.get as never,
						});
					}
				}
			};
		};
		const baseFn = normalizeBeforeChange(base.beforeChange);
		const extFn = normalizeBeforeChange(extension.beforeChange);
		merged.beforeChange = (ctx) => {
			baseFn?.(ctx);
			extFn?.(ctx);
		};
	}
	if (base.onChange || extension.onChange) {
		// Normalize both forms to catch-all functions for merging
		const normalizeOnChange = (
			handler: ScopeConfig<Def>['onChange'],
		):
			| ((ctx: {
					changes: ScopeChanges;
					set: ScopeSet<Def>;
					get: ScopeGet<Def>;
					getSnapshot: () => Record<string, unknown>;
			  }) => void)
			| undefined => {
			if (!handler) return undefined;
			if (typeof handler === 'function') return handler;
			// Object form → wrap in a function
			return (ctx) => {
				for (const [, change] of ctx.changes) {
					const fieldHandler = (
						handler as Record<
							string,
							| ((ctx: {
									from: unknown;
									to: unknown;
									set: unknown;
									get: unknown;
							  }) => void)
							| undefined
						>
					)[change.key];
					if (fieldHandler) {
						fieldHandler({
							from: change.from,
							to: change.to,
							set: ctx.set as never,
							get: ctx.get as never,
						});
					}
				}
			};
		};
		const baseFn = normalizeOnChange(base.onChange);
		const extFn = normalizeOnChange(extension.onChange);
		merged.onChange = (ctx) => {
			baseFn?.(ctx);
			extFn?.(ctx);
		};
	}
	if (base.onUsed || extension.onUsed) {
		merged.onUsed = (ctx) => {
			base.onUsed?.(ctx);
			extension.onUsed?.(ctx);
		};
	}
	if (base.onUnused || extension.onUnused) {
		merged.onUnused = (ctx) => {
			base.onUnused?.(ctx);
			extension.onUnused?.(ctx);
		};
	}
	if (base.onDestroy || extension.onDestroy) {
		merged.onDestroy = (ctx) => {
			base.onDestroy?.(ctx);
			extension.onDestroy?.(ctx);
		};
	}

	return merged;
}

// --- Factory ---

/**
 * Define a scope — a structured, reactive model with typed fields,
 * derivations, and lifecycle hooks.
 *
 * @typeParam Def - the scope definition record (inferred from `definition`)
 * @param definition - an object mapping field names to {@link Value}, {@link ValueRef}, or derivation functions
 * @param config - optional {@link ScopeConfig} with lifecycle hooks
 * @returns a {@link ScopeTemplate} that can create instances via `.create()`
 *
 * @example
 * ```ts
 * const person = valueScope({
 *   first: value(""),
 *   last: value(""),
 *   full: (get) => `${get("first")} ${get("last")}`,
 * });
 *
 * const alice = person.create({ first: "Alice", last: "Smith" });
 * alice.get("full"); // "Alice Smith"
 * ```
 *
 * @see {@link ScopeTemplate} for `.create()`, `.extend()`, `.createMap()`
 * @see {@link ScopeInstance} for the instance API
 */
export function valueScope<Def extends Record<string, ScopeEntry>>(
	definition: Def,
	config?: ScopeConfig<Def>,
): ScopeTemplate<Def> {
	return new ScopeTemplate(definition, config);
}
