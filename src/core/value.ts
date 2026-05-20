import { signal, type Signal } from './signal.js';
import { subscribeWithPrevious } from './utils/effect-helpers.js';
import { DisposerBag } from './utils/disposer-bag.js';
import {
	applySyncSteps,
	type ActiveFactoryPipe,
	type InternalPipeStep,
	type SyncPipeStep,
} from './utils/pipe-internal.js';
import { applyBrand, hasBrand } from './utils/brand.js';
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
	readonly #bag = new DisposerBag();
	readonly #activeFactories: ActiveFactoryPipe[] = [];

	/** @internal */
	constructor(initial: Out, pipeSteps?: InternalPipeStep[]) {
		if (pipeSteps) {
			this._pipeSteps = pipeSteps;
		}
		this._signal = signal(initial);
		applyBrand(this, VALUE_INSTANCE_BRAND);
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

		// If there are factory pipes, route through the first factory.
		// Factory pipes call set() on the signal themselves.
		const firstFactoryIndex = this._pipeSteps.findIndex(
			(step) => step.kind === 'factory',
		);

		if (firstFactoryIndex !== -1) {
			// Apply sync steps before the first factory
			let current: unknown = raw;
			for (let i = 0; i < firstFactoryIndex; i++) {
				const step = this._pipeSteps[i] as SyncPipeStep;
				current = step.transform(current);
			}
			// Hand off to the first factory's writer
			this.#activeFactories[0]?.write(current);
			return;
		}

		// All sync pipes — apply in order
		const next = applySyncSteps(this._pipeSteps, raw) as Out;

		if (this._comparator && this._comparator(previous, next)) {
			return;
		}

		this._signal.value = next;
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
					descriptor: transformOrDescriptor as PipeFactoryDescriptor<
						unknown,
						unknown
					>,
				}
			:	{
					kind: 'sync',
					transform: transformOrDescriptor as Transform<unknown, unknown>,
				};

		const allSteps = [...this._pipeSteps, newStep];

		// Create a new Value with the piped initial value
		const currentValue = this._signal.peek();

		if (isFactory) {
			const newValue = new Value<In>(currentValue as unknown as In, allSteps);
			// Preserve comparator through the pipe.
			// Safe across type changes: the comparator runs against post-pipe
			// values and is cast at the TS layer; runtime behavior is correct.
			newValue._comparator = this._comparator as Comparator<In> | undefined;
			// Activate the factory pipe
			newValue.#activateFactories();
			// Hand the current value directly to the first factory rather
			// than going through `set()`. `set()` would re-apply every sync
			// pre-step against `currentValue`, but `currentValue` is the
			// prior Value's signal value — which already had those sync
			// steps applied at *its* construction. Calling `set()` here
			// would silently double-apply them (so `value(5).pipe(x => x*2)
			// .pipe(pipeFilter(>5))` would store 20 instead of 10). Bypassing
			// `set` keeps the sync chain single-pass while still letting
			// stateful factories (pipeScan, pipeUnique, pipeDebounce, …)
			// observe the current value.
			newValue.#activeFactories[0]?.write(currentValue);
			return newValue as unknown as Value<In, NewOut>;
		}

		// Sync transform: apply to get the initial output value
		const transform = transformOrDescriptor;
		const transformedInitial = transform(currentValue) as unknown as In;
		const newValue = new Value<In>(transformedInitial, allSteps);
		// Preserve comparator through the pipe.
		newValue._comparator = this._comparator as Comparator<In> | undefined;
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
		// Standalone values return a non-reactive snapshot.
		// React integration is handled by FieldValue in scope instances.
		return [
			this.get(),
			(valueOrFn) => {
				this.set(valueOrFn as In | ((prev: Out) => In));
			},
		];
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
		for (const factory of this.#activeFactories) {
			for (const cleanup of factory.cleanups) cleanup();
		}
		this.#activeFactories.length = 0;
	}

	/** @internal — activate factory pipe instances */
	#activateFactories(): void {
		let factoryIndex = 0;
		for (let i = 0; i < this._pipeSteps.length; i++) {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const step = this._pipeSteps[i]!;
			if (step.kind !== 'factory') continue;

			const isLastFactory = !this._pipeSteps
				.slice(i + 1)
				.some((s) => s.kind === 'factory');

			// Collect sync steps after this factory (until the next factory or end)
			const syncStepsAfter: SyncPipeStep[] = [];
			for (let j = i + 1; j < this._pipeSteps.length; j++) {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				const nextStep = this._pipeSteps[j]!;
				if (nextStep.kind === 'factory') break;
				syncStepsAfter.push(nextStep);
			}

			const cleanups: (() => void)[] = [];
			const currentFactoryIndex = factoryIndex;
			const write = step.descriptor.create({
				set: (value: unknown) => {
					// Apply any sync steps after this factory
					let current = value;
					for (const syncStep of syncStepsAfter) {
						current = syncStep.transform(current);
					}

					if (isLastFactory) {
						// Final factory — write to signal
						const previous = this._signal.peek();
						if (
							this._comparator &&
							this._comparator(previous, current as Out)
						) {
							return;
						}
						this._signal.value = current as Out;
					} else {
						// Chain to next factory
						this.#activeFactories[currentFactoryIndex + 1]?.write(current);
					}
				},
				onCleanup: (fn: () => void) => {
					cleanups.push(fn);
				},
			});

			this.#activeFactories.push({ write, cleanups });
			factoryIndex++;
		}
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
