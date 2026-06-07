import type { AsyncState } from './async-state.js';
import type { ValidationState } from './value-schema.js';
import type { InstanceStore } from './instance-store.js';
import type { Setter, Unsubscribe } from './types.js';
import {
	getReactHooks,
	reactiveSnapshot,
	versionedAdapter,
} from './react-bridge.js';
import { applyBrand, hasBrand } from './utils/brand.js';

// --- Brand symbols for type guards ---

const VALUE_BRAND = Symbol.for('valuse.value');
const SCHEMA_BRAND = Symbol.for('valuse.schema');
const PLAIN_BRAND = Symbol.for('valuse.plain');
const COMPUTED_BRAND = Symbol.for('valuse.computed');
const SCOPE_BRAND = Symbol.for('valuse.scope');

/**
 * The runtime type of a `value()` field on a scope instance.
 * Delegates all operations to the shared InstanceStore via a slot index.
 *
 * @typeParam In - the type accepted by `.set()`
 * @typeParam Out - the type returned by `.get()` (defaults to In)
 */
export class FieldValue<In, Out = In> {
	readonly #store: InstanceStore;
	readonly #slot: number;
	/** Bound, identity-stable `Setter<In>` exposed via `.use()`. @internal */
	protected readonly _setter: Setter<In>;

	/** @internal */
	constructor(store: InstanceStore, slot: number) {
		this.#store = store;
		this.#slot = slot;
		this._setter = (valueOrFn) => {
			this.set(valueOrFn as In | ((prev: Out) => In));
		};
		applyBrand(this, VALUE_BRAND);
	}

	/** Read the current value. */
	get(): Out {
		return this.#store.read(this.#slot) as Out;
	}

	/**
	 * Write a new value, or derive the next value from the previous one.
	 * @param valueOrFn - the new value, or a function that receives the current value and returns a new one.
	 */
	set(valueOrFn: In | ((prev: Out) => In)): void {
		const raw =
			typeof valueOrFn === 'function' ?
				(valueOrFn as (prev: Out) => In)(this.get())
			:	valueOrFn;
		this.#store.write(this.#slot, raw);
	}

	/**
	 * React hook. Returns `[value, setter]`.
	 * Re-renders the component when the value changes.
	 * Outside React, returns a non-reactive snapshot.
	 * @returns a `[value, setter]` tuple.
	 */
	use(): [Out, Setter<In>] {
		const snapshot = reactiveSnapshot(
			this,
			(onChange) => this.subscribe(onChange),
			() => this.get(),
		);
		return [snapshot, this._setter];
	}

	/**
	 * Listen for changes to this field.
	 * @param fn - callback fired with the new and previous values on each change.
	 * @returns an {@link Unsubscribe} function.
	 */
	subscribe(fn: (value: Out, previous: Out) => void): Unsubscribe {
		return this.#store.subscribe(
			this.#slot,
			fn as (value: unknown, previous: unknown) => void,
		);
	}

	/**
	 * Expedite any pending deferred work in this field's pipe chain and
	 * resolve once it settles. Resolves immediately when there is none.
	 */
	flush(): Promise<void> {
		return this.#store.flushSlot(this.#slot);
	}
}

/**
 * The runtime type of a `valueSchema()` field on a scope instance.
 * Extends FieldValue with `.getValidation()` and `.useValidation()`.
 *
 * @remarks
 * Note the parent specialization `FieldValue<In, In>`, not `<In, Out>`. The
 * underlying signal stores the **raw input** (so writes can be revisited and
 * re-validated, even when invalid). The schema's parsed `Out` form is
 * exposed only through {@link FieldValueSchema.getValidation} /
 * {@link FieldValueSchema.useValidation}, which is why `.get()` returns `In`
 * rather than `Out`.
 *
 * @typeParam In - the schema's input type (accepted by `.set()`)
 * @typeParam Out - the schema's output type (available via validation when valid)
 */
export class FieldValueSchema<In, Out = In> extends FieldValue<In, In> {
	readonly #store: InstanceStore;
	readonly #slot: number;

	/** @internal */
	constructor(store: InstanceStore, slot: number) {
		super(store, slot);
		this.#store = store;
		this.#slot = slot;
		applyBrand(this, SCHEMA_BRAND);
	}

	/** Read the current validation state without reactive tracking. */
	getValidation(): ValidationState<In, Out> {
		return this.#store.readValidation(this.#slot) as ValidationState<In, Out>;
	}

	/**
	 * React hook. Returns `[value, setter, validationState]`.
	 * Re-renders when either the value or the validation state changes.
	 * Outside React, returns a non-reactive snapshot.
	 */
	useValidation(): [In, Setter<In>, ValidationState<In, Out>] {
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(this, (onChange) => {
				const unsub1 = this.subscribe(() => {
					onChange();
				});
				const unsub2 = this.#store.subscribeValidation(this.#slot, () => {
					onChange();
				});
				return () => {
					unsub1();
					unsub2();
				};
			});
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return [this.get(), this._setter, this.getValidation()];
	}
}

/**
 * The runtime type of a `valuePlain()` field on a scope instance.
 * Supports `.get()` and `.set()` but no `.use()` or `.subscribe()`,
 * since it does not participate in the reactive graph or change tracking.
 *
 * @remarks
 * Plain fields are intentionally **inert**: they do not trigger derivations,
 * `$subscribe` callbacks, `onChange` lifecycle hooks, devtools actions, or
 * history entries. Use them for instance-scoped data that doesn't drive UI
 * (handles, refs, ids, configuration) where the cost of reactivity isn't
 * worth paying. If you need any of these behaviors, use `value()` instead.
 *
 * @typeParam In - the type accepted by `.set()`
 * @typeParam Out - the type returned by `.get()` (defaults to In)
 */
export class FieldValuePlain<In, Out = In> {
	readonly #store: InstanceStore;
	readonly #slot: number;

	/** @internal */
	constructor(store: InstanceStore, slot: number) {
		this.#store = store;
		this.#slot = slot;
		applyBrand(this, PLAIN_BRAND);
	}

	/** Read the current value. */
	get(): Out {
		return this.#store.read(this.#slot) as Out;
	}

	/**
	 * Write a new value, or derive the next value from the previous one.
	 *
	 * @throws {TypeError} if the slot was declared with `{ readonly: true }`.
	 * @param valueOrFn - the new value, or a function that receives the current value and returns a new one.
	 */
	set(valueOrFn: In | ((prev: Out) => In)): void {
		if (this.#store.isReadonly(this.#slot)) {
			const path = this.#store.definition.slots[this.#slot]?.path ?? '?';
			throw new TypeError(
				`Cannot set readonly plain field "${path}". Declared with valuePlain(..., { readonly: true }).`,
			);
		}
		const raw =
			typeof valueOrFn === 'function' ?
				(valueOrFn as (prev: Out) => In)(this.get())
			:	valueOrFn;
		this.#store.write(this.#slot, raw);
	}
}

/**
 * The runtime type of a sync derivation field on a scope instance.
 * Read-only; no `.set()`.
 *
 * @typeParam T - the derived value type
 */
export class FieldDerived<T> {
	readonly #store: InstanceStore;
	readonly #slot: number;

	/** @internal */
	constructor(store: InstanceStore, slot: number) {
		this.#store = store;
		this.#slot = slot;
		applyBrand(this, COMPUTED_BRAND);
	}

	/** Read the current derived value. */
	get(): T {
		return this.#store.read(this.#slot) as T;
	}

	/**
	 * React hook. Returns `[value]`.
	 * Re-renders the component when the derived value changes.
	 * Outside React, returns a non-reactive snapshot.
	 * @returns a single-element `[value]` tuple.
	 */
	use(): [T] {
		const snapshot = reactiveSnapshot(
			this,
			(onChange) => this.subscribe(onChange),
			() => this.get(),
		);
		return [snapshot];
	}

	/**
	 * Listen for changes to this derived value.
	 * @param fn - callback fired with the new and previous values on each change.
	 * @returns an {@link Unsubscribe} function.
	 */
	// `FieldDerived` and `FieldValue` are intentionally parallel hierarchies:
	// merging them would either pull `.set()` into derived fields or force a
	// shared abstract base that exposes `#store` / `#slot` as `protected`,
	// both worse than this 4-line repeat.
	// eslint-disable-next-line sonarjs/no-identical-functions
	subscribe(fn: (value: T, previous: T) => void): Unsubscribe {
		return this.#store.subscribe(
			this.#slot,
			fn as (value: unknown, previous: unknown) => void,
		);
	}

	/** Re-run this derivation. */
	recompute(): void {
		this.#store.recompute(this.#slot);
	}

	/**
	 * Expedite the current run's `deferBy` and resolve once the run
	 * settles. On sync derivations (no deferred work) this resolves
	 * immediately.
	 */
	flush(): Promise<void> {
		return this.#store.flushSlot(this.#slot);
	}
}

/**
 * The runtime type of an async derivation field on a scope instance.
 * Extends FieldDerived with async status tracking.
 *
 * @typeParam T - the resolved value type
 */
export class FieldAsyncDerived<T> extends FieldDerived<T | undefined> {
	readonly #store: InstanceStore;
	readonly #slot: number;

	/** @internal */
	constructor(store: InstanceStore, slot: number) {
		super(store, slot);
		this.#store = store;
		this.#slot = slot;
	}

	/** Read the full async state (status, value, error). */
	getAsync(): AsyncState<T> {
		return this.#store.readAsync(this.#slot) as AsyncState<T>;
	}

	/**
	 * React hook for async state. Returns `[value, asyncState]`.
	 * Re-renders on value changes AND async state transitions.
	 * Outside React, returns a non-reactive snapshot.
	 */
	useAsync(): [T | undefined, AsyncState<T>] {
		const hooks = getReactHooks();
		if (hooks) {
			// Use versionedAdapter with a combined subscription that fires on
			// either value change or async state change
			const adapter = versionedAdapter(this, (onChange) => {
				const unsub1 = this.subscribe(() => {
					onChange();
				});
				const unsub2 = this.#store.subscribeAsyncState(this.#slot, () => {
					onChange();
				});
				return () => {
					unsub1();
					unsub2();
				};
			});
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
			return [this.get(), this.getAsync()];
		}
		return [this.get(), this.getAsync()];
	}
}

// --- Derivation context wrappers ---

/**
 * Wrapper used inside derivation bodies. `.use()` reads with Preact tracking;
 * `.get()` reads without tracking (peek).
 *
 * Built per-instance as part of the derivation scope tree.
 *
 * @internal
 */
export class DerivationWrap {
	readonly #store: InstanceStore;
	readonly #slot: number;

	constructor(store: InstanceStore, slot: number) {
		this.#store = store;
		this.#slot = slot;
	}

	/** Read with Preact tracking — establishes a reactive dependency. */
	use(): unknown {
		return this.#store.readTracked(this.#slot);
	}

	/** Read without tracking (peek). */
	get(): unknown {
		return this.#store.read(this.#slot);
	}
}

// --- Type guards ---

/**
 * Check if a value is a FieldValue (reactive, has .get()/.set()/.use()).
 */
export function isValue(value: unknown): value is FieldValue<unknown> {
	return hasBrand(value, VALUE_BRAND);
}

/**
 * Check if a value is a FieldValueSchema (schema-validated, has .getValidation()).
 */
export function isSchema(
	value: unknown,
): value is FieldValueSchema<unknown, unknown> {
	return hasBrand(value, SCHEMA_BRAND);
}

/**
 * Check if a value is a FieldValuePlain (non-reactive, has .get()/.set(), no .use()).
 */
export function isPlain(value: unknown): value is FieldValuePlain<unknown> {
	return hasBrand(value, PLAIN_BRAND);
}

/**
 * Check if a value is a FieldDerived or FieldAsyncDerived (computed, has
 * .get()/.use(), no .set()).
 */
export function isComputed(value: unknown): value is FieldDerived<unknown> {
	return hasBrand(value, COMPUTED_BRAND);
}

/**
 * Check if a value is a scope instance (has $ methods).
 */
export function isScope(value: unknown): value is Record<string, unknown> {
	return hasBrand(value, SCOPE_BRAND);
}

/** @internal — brand a scope instance for isScope(). */
export function brandAsScope(instance: Record<string, unknown>): void {
	applyBrand(instance, SCOPE_BRAND);
}
