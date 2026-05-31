import { signal, type Signal } from './signal.js';
import { subscribeWithPrevious } from './utils/effect-helpers.js';
import { DisposerBag } from './utils/disposer-bag.js';
import {
	applySyncSteps,
	type InternalPipeStep,
} from './utils/pipe-internal.js';
import { buildPipeChain, type PipeChain } from './utils/pipe-runtime.js';
import { applyBrand, hasBrand } from './utils/brand.js';
import { getReactHooks, stableSubscribe } from './react-bridge.js';
import type {
	Comparator,
	Transform,
	PipeFactoryDescriptor,
	Unsubscribe,
	Setter,
} from './types.js';

const VALUE_INSTANCE_BRAND = Symbol.for('valuse.Value');

/**
 * A single piece of reactive state.
 *
 * Wraps a signal with transforms, custom comparison, subscriptions,
 * and an optional React hook via `.use()`.
 *
 * @typeParam In - the type accepted by `.set()`.
 * @typeParam Out - the type returned by `.get()`. Defaults to `In`.
 *
 * @example
 * ```ts
 * const count = value(0);
 * count.get(); // 0
 * count.set(5);
 * count.set(prev => prev + 1);
 * ```
 *
 * @example
 * ### Using Pipes
 * ```ts
 * const email = value("")
 *   .pipe(v => v.trim())
 *   .pipe(v => v.toLowerCase());
 *
 * email.set("  User@Example.Com  ");
 * email.get(); // "user@example.com"
 * ```
 *
 * @see {@link value} factory function for creating instances.
 */
export class Value<In, Out = In> {
	/** @internal */
	_signal: Signal<Out>;
	/** @internal */
	readonly _pipeSteps: InternalPipeStep[] = [];
	/** @internal */
	_comparator: Comparator<Out> | undefined;
	/**
	 * Pre-actor seed: the value the first factory pipe in `_pipeSteps` was
	 * primed with at definition time. Captured here so scope-instance
	 * activation can prime its fresh actors with the same value — keeping
	 * stateful actors (scan, unique, throttle, …) consistent between
	 * standalone Value and scope fields. Undefined for chains with no
	 * factory step.
	 * @internal
	 */
	_factorySeed: unknown = undefined;
	readonly #bag = new DisposerBag();
	readonly #chain: PipeChain;
	/** Bound, identity-stable `Setter<In>` exposed via `.use()`. @internal */
	readonly #setter: Setter<In>;

	/** @internal */
	constructor(initial: Out, pipeSteps?: InternalPipeStep[]) {
		if (pipeSteps) {
			this._pipeSteps = pipeSteps;
		}
		this._signal = signal(initial);
		this.#setter = (valueOrFn) => {
			this.set(valueOrFn as In | ((prev: Out) => In));
		};
		this.#chain = buildPipeChain(this._pipeSteps, (value) => {
			this.#commit(value);
		});
		applyBrand(this, VALUE_INSTANCE_BRAND);
	}

	/** Run the comparator and write to the signal. @internal */
	#commit(value: unknown): void {
		const previous = this._signal.peek();
		if (this._comparator && this._comparator(previous, value as Out)) return;
		this._signal.value = value as Out;
	}

	/**
	 * Read the current value.
	 *
	 * @returns the current value of type `Out`.
	 */
	get(): Out {
		return this._signal.value;
	}

	/**
	 * Write a new value, or derive the next value from the previous one.
	 *
	 * @param valueOrFn - the new value of type `In`, or a function that receives
	 * the current `Out` value and returns a new `In` value.
	 *
	 * @example
	 * ```ts
	 * count.set(10);
	 * count.set(prev => prev + 1);
	 * ```
	 */
	set(valueOrFn: In | ((prev: Out) => In)): void {
		// After destroy, writes are silently dropped — matches `ValueArray`,
		// the RxJS Subject pattern, and the per-instance Lifecycle contract
		// in the README. Reads still return the last value.
		if (this.#bag.destroyed) return;
		const previous = this._signal.peek();
		const raw =
			typeof valueOrFn === 'function' ?
				(valueOrFn as (prev: Out) => In)(previous)
			:	valueOrFn;

		// Factory pipes (actors) own their own scheduling and commit
		// downstream via the chain. The chain applies leading sync steps.
		if (this.#chain.hasActors) {
			this.#chain.write(raw);
			return;
		}

		// All sync pipes — apply in order, then commit.
		this.#commit(applySyncSteps(this._pipeSteps, raw));
	}

	/**
	 * Listen for changes. The callback fires on every update after subscription.
	 *
	 * @param fn - callback called with the new value and the previous value on each change.
	 * @returns an {@link Unsubscribe} function to stop listening.
	 *
	 * @example
	 * ```ts
	 * const unsub = count.subscribe((val, prev) => {
	 *   console.log(`Changed from ${prev} to ${val}`);
	 * });
	 * count.set(1); // logs "Changed from 0 to 1"
	 * unsub();
	 * ```
	 */
	subscribe(fn: (value: Out, previous: Out) => void): Unsubscribe {
		return this.#bag.attach(
			subscribeWithPrevious(
				() => this._signal.value,
				() => this._signal.peek(),
				fn,
			),
		);
	}

	/**
	 * Add a synchronous transform that runs on every `.set()` call.
	 * When the transform preserves the type, returns `this` for chaining.
	 *
	 * @param transform - a function that receives and returns the value.
	 * @returns `this` for chaining.
	 */
	pipe(transform: Transform<Out, Out>): this;
	/**
	 * Add a type-changing synchronous transform. Returns a new `Value` with the
	 * updated output type.
	 *
	 * @param transform - a function that receives the current output and returns a new type.
	 * @returns a new `Value` instance with the new output type.
	 */
	pipe<NewOut>(transform: Transform<Out, NewOut>): Value<In, NewOut>;
	/**
	 * Add a factory pipe. The factory's `create` is called immediately and
	 * returns a writer that receives each incoming value. Returns a new `Value`
	 * with the updated output type.
	 *
	 * @param descriptor - a pipe factory descriptor (e.g., from `debounce` or `delay`).
	 * @returns a new `Value` instance with the new output type.
	 *
	 * @example
	 * ```ts
	 * import { debounce } from 'valuse';
	 * const search = value("").pipe(debounce(300));
	 * ```
	 */
	pipe<NewOut>(
		// eslint-disable-next-line @typescript-eslint/unified-signatures
		descriptor: PipeFactoryDescriptor<Out, NewOut>,
	): Value<In, NewOut>;
	// Implementation
	pipe<NewOut>(
		transformOrDescriptor:
			| Transform<Out, NewOut>
			| PipeFactoryDescriptor<Out, NewOut>,
	): Value<In, NewOut> {
		const isFactory =
			typeof transformOrDescriptor === 'object' &&
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			transformOrDescriptor !== null &&
			'create' in transformOrDescriptor;

		const newStep: InternalPipeStep =
			isFactory ?
				{
					kind: 'factory',
					descriptor: transformOrDescriptor,
				}
			:	{
					kind: 'sync',
					transform: transformOrDescriptor as Transform<unknown, unknown>,
				};

		const allSteps = [...this._pipeSteps, newStep];
		const currentValue = this._signal.peek();
		const hasFactory = allSteps.some((step) => step.kind === 'factory');

		// Initial signal value for the new instance. When the chain has
		// actors, `prime()` computes the real initial by running
		// `currentValue` through the actors; use `currentValue` as a
		// placeholder. For a pure-sync chain, apply the new transform.
		const newInitial =
			hasFactory ?
				(currentValue as unknown as In)
			:	((transformOrDescriptor as Transform<Out, NewOut>)(
					currentValue,
				) as unknown as In);

		const newValue = new Value<In>(newInitial, allSteps);
		// Preserve comparator through the pipe.
		// Safe across type changes: the comparator runs against post-pipe
		// values and is cast at the TS layer; runtime behavior is correct.
		newValue._comparator = this._comparator as Comparator<In> | undefined;

		// Capture the pre-actor seed (the value the first factory was primed
		// with) and propagate it through subsequent `.pipe()` calls. Used by
		// scope-instance activation to prime its fresh actors with the same
		// seed — so stateful actors (scan, unique, throttle) behave
		// consistently between standalone Value and scope fields.
		if (hasFactory) {
			const priorHadFactory = this._pipeSteps.some(
				(step) => step.kind === 'factory',
			);
			newValue._factorySeed =
				priorHadFactory ? this._factorySeed : currentValue;
		}

		// Prime the freshly-built chain so stateful actors (scan, unique,
		// throttle, …) observe the current value. `prime` enters at the
		// first actor, skipping leading sync steps — `currentValue` already
		// had those applied at the prior instance's construction, so
		// re-applying would double them (e.g. `value(5).pipe(x => x*2)
		// .pipe(pipeFilter(>5))` would store 20 instead of 10).
		if (newValue.#chain.hasActors) {
			newValue.#chain.prime(currentValue);
		}

		return newValue as unknown as Value<In, NewOut>;
	}

	/**
	 * Override the default identity comparison. When the comparator returns
	 * `true`, the update is skipped and subscribers are not notified.
	 * Comparison runs on the post-pipe value.
	 *
	 * @param comparator - function that returns `true` if two values are equal.
	 * @returns `this` for chaining.
	 *
	 * @example
	 * ```ts
	 * const user = value({ id: 1, name: "Alice" })
	 *   .compareUsing((a, b) => a.id === b.id);
	 * ```
	 */
	compareUsing(comparator: Comparator<Out>): this {
		this._comparator = comparator;
		return this;
	}

	/**
	 * React hook. Returns `[value, setter]`.
	 * Re-renders the component when the value changes.
	 *
	 * @remarks
	 * Requires `valuse/react` to be imported. Outside React, returns a
	 * non-reactive snapshot.
	 *
	 * @returns a `[value, setter]` tuple.
	 *
	 * @example
	 * ```tsx
	 * function MyComponent() {
	 *   const [name, setName] = userName.use();
	 *   return <input value={name} onChange={e => setName(e.target.value)} />;
	 * }
	 * ```
	 */
	use(): [Out, Setter<In>] {
		const hooks = getReactHooks();
		if (hooks) {
			const subscribe = stableSubscribe(this, (onChange) =>
				this.subscribe(() => {
					onChange();
				}),
			);
			const snapshot = hooks.useSyncExternalStore(subscribe, () => this.get());
			return [snapshot, this.#setter];
		}
		// Non-React (or `valuse/react` not imported): non-reactive snapshot.
		return [this.get(), this.#setter];
	}

	/**
	 * Dispose all active subscriptions and factory pipe cleanups.
	 *
	 * After destroy, reads still return the last value, writes are no-ops,
	 * and existing subscribers stop firing. Idempotent — calling twice does
	 * nothing the second time.
	 */
	destroy(): void {
		if (!this.#bag.destroy()) return;
		this.#chain.destroy();
	}

	/**
	 * Expedite any pending deferred work in the pipe chain (debounce or
	 * throttle timers, batched writes, etc.) and resolve once the chain
	 * settles. Resolves immediately for values without flushable pipes.
	 */
	flush(): Promise<void> {
		return this.#chain.flush();
	}
}

// --- Factory overloads ---

/**
 * Create a reactive value with no initial value (starts as `undefined`).
 *
 * @typeParam T - the type of the stored value.
 * @returns a new {@link Value} instance.
 *
 * @example
 * ```ts
 * const count = value<number>();    // Value<number | undefined>
 * const name = value<string | null>(null);
 * ```
 */
export function value<T>(): Value<T | undefined>;
/**
 * Create a reactive value with a default.
 *
 * @param initial - the initial value to store.
 * @typeParam T - the type of the stored value.
 * @returns a new {@link Value} instance.
 */
export function value<T>(initial: T): Value<T>;
// Implementation
export function value<T>(initial?: T): Value<T | undefined> {
	return new Value(initial);
}

/**
 * Check if a value is a Value instance (used by the scope definition walker).
 * @internal
 */
export function isValueInstance(v: unknown): v is Value<unknown> {
	return hasBrand(v, VALUE_INSTANCE_BRAND);
}
