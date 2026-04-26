import { signal, effect, type Signal } from './signal.js';
import type {
	Comparator,
	Transform,
	PipeFactoryDescriptor,
	Unsubscribe,
	Setter,
} from './types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

const VALUE_SCHEMA_BRAND = Symbol.for('valuse.ValueSchema');

// --- ValidationState ---

/**
 * Validation result for a schema-validated value. Discriminated union on `isValid`.
 *
 * When valid, `value` is the schema's parsed output type.
 * When invalid, `value` is the raw input that was last set.
 *
 * @typeParam In - the schema's input type (what `.set()` accepts)
 * @typeParam Out - the schema's output type (the parsed/narrowed result)
 */
export type ValidationState<In, Out> =
	| {
			readonly isValid: true;
			readonly value: Out;
			readonly issues: readonly [];
	  }
	| {
			readonly isValid: false;
			readonly value: In;
			readonly issues: readonly StandardSchemaV1.Issue[];
	  };

// --- SyncStandardSchema constraint ---

/**
 * Marker type for documentation. The Standard Schema spec always includes
 * `Promise` in the `validate` return union, so compile-time async rejection
 * isn't possible via the base interface. Async schemas that return a Promise
 * at runtime are caught with a clear error in {@link runValidation}.
 */
export type SyncStandardSchema<S extends StandardSchemaV1> = S;

// --- Internal pipe step representation ---

interface SyncPipeStep<In = unknown, Out = unknown> {
	kind: 'sync';
	transform: Transform<In, Out>;
}

interface FactoryPipeStep<In = unknown, Out = unknown> {
	kind: 'factory';
	descriptor: PipeFactoryDescriptor<In, Out>;
}

type InternalPipeStep = SyncPipeStep | FactoryPipeStep;

/**
 * Run a Standard Schema validation and return a ValidationState.
 * @internal
 */
export function runValidation<In, Out>(
	schema: StandardSchemaV1,
	input: In,
): ValidationState<In, Out> {
	const result = schema['~standard'].validate(input);

	// Guard against async schemas that slipped through at runtime
	if (result instanceof Promise) {
		throw new Error(
			'valueSchema received an async schema. Only synchronous schemas are supported.',
		);
	}

	if ('issues' in result && result.issues) {
		return {
			isValid: false,
			value: input,
			issues: [...result.issues],
		};
	}

	return {
		isValid: true,
		value: (result as { value: Out }).value,
		issues: [],
	};
}

/**
 * A reactive value paired with a Standard Schema validator.
 *
 * The value holds whatever was last set. Validation state lives alongside it
 * as metadata: ignore it if you don't need it, read it when you do.
 *
 * @typeParam In - the schema's input type (accepted by `.set()`)
 * @typeParam Out - the schema's output type (available via `.getValidation()` when valid)
 */
export class ValueSchema<In, Out = In> {
	/** @internal */
	_signal: Signal<In>;
	/** @internal */
	_validationSignal: Signal<ValidationState<In, Out>>;
	/** @internal */
	readonly _schema: StandardSchemaV1;
	/** @internal */
	readonly _pipeSteps: InternalPipeStep[] = [];
	/** @internal */
	_comparator: Comparator<In> | undefined;
	readonly #disposers: (() => void)[] = [];

	/** @internal */
	constructor(
		schema: StandardSchemaV1,
		initial: In,
		pipeSteps?: InternalPipeStep[],
	) {
		this._schema = schema;
		if (pipeSteps) {
			this._pipeSteps = pipeSteps;
		}
		this._signal = signal(initial);
		this._validationSignal = signal(runValidation<In, Out>(schema, initial));
		Object.defineProperty(this, VALUE_SCHEMA_BRAND, {
			value: true,
			enumerable: false,
		});
	}

	/** Read the current value. */
	get(): In {
		return this._signal.value;
	}

	/**
	 * Write a new value, or derive the next value from the previous one.
	 * The value is stored regardless of validity. Validation state is updated.
	 */
	set(valueOrFn: In | ((prev: In) => In)): void {
		const previous = this._signal.peek();
		const raw =
			typeof valueOrFn === 'function' ?
				(valueOrFn as (prev: In) => In)(previous)
			:	valueOrFn;

		// Apply sync pipe transforms
		const next = this.#applyAllSyncTransforms(raw as unknown) as In;

		// Comparator check
		if (this._comparator && this._comparator(previous, next)) {
			return;
		}

		// Write value
		this._signal.value = next;

		// Validate and update validation state
		this._validationSignal.value = runValidation<In, Out>(this._schema, next);
	}

	/** Read the current validation state without reactive tracking. */
	getValidation(): ValidationState<In, Out> {
		return this._validationSignal.peek();
	}

	/**
	 * Listen for changes. The callback fires on every update after subscription.
	 */
	subscribe(fn: (value: In, previous: In) => void): Unsubscribe {
		let isFirstRun = true;
		let previousValue = this._signal.peek();
		const dispose = effect(() => {
			const currentValue = this._signal.value;
			if (isFirstRun) {
				isFirstRun = false;
				return;
			}
			const prev = previousValue;
			previousValue = currentValue;
			fn(currentValue, prev);
		});
		this.#disposers.push(dispose);
		return () => {
			dispose();
			const index = this.#disposers.indexOf(dispose);
			if (index !== -1) this.#disposers.splice(index, 1);
		};
	}

	/**
	 * Add a synchronous transform that runs on every `.set()` call, before validation.
	 */
	pipe(transform: Transform<In, In>): this;
	pipe<NewIn>(transform: Transform<In, NewIn>): ValueSchema<NewIn, Out>;
	pipe<NewIn>(transform: Transform<In, NewIn>): ValueSchema<NewIn, Out> {
		const newStep: InternalPipeStep = {
			kind: 'sync',
			transform: transform as Transform<unknown, unknown>,
		};
		const allSteps = [...this._pipeSteps, newStep];
		const currentValue = this._signal.peek();
		const transformedInitial = transform(currentValue) as unknown as NewIn;
		const newSchema = new ValueSchema<NewIn, Out>(
			this._schema,
			transformedInitial,
			allSteps,
		);
		return newSchema;
	}

	/**
	 * Override the default identity comparison. When the comparator returns
	 * `true`, the update is skipped and subscribers are not notified.
	 */
	compareUsing(comparator: Comparator<In>): this {
		this._comparator = comparator;
		return this;
	}

	/**
	 * React hook. Returns `[value, setter]`.
	 * Outside React, returns a non-reactive snapshot.
	 */
	use(): [In, Setter<In>] {
		return [
			this.get(),
			(valueOrFn) => {
				this.set(valueOrFn as In | ((prev: In) => In));
			},
		];
	}

	/** Dispose all active subscriptions. */
	destroy(): void {
		for (const dispose of this.#disposers) dispose();
		this.#disposers.length = 0;
	}

	/** @internal */
	#applyAllSyncTransforms(value: unknown): unknown {
		let current = value;
		for (const step of this._pipeSteps) {
			if (step.kind === 'sync') {
				current = step.transform(current);
			}
		}
		return current;
	}
}

// --- Factory function ---

/**
 * Create a reactive value paired with a Standard Schema validator.
 *
 * @param schema - any sync Standard Schema-compliant schema.
 * @param defaultValue - the initial value, typed as the schema's input.
 * @returns a new {@link ValueSchema} instance.
 *
 * @example
 * ```ts
 * import { type } from 'arktype';
 * const Email = type('string.email');
 * const email = valueSchema(Email, '');
 * email.set('bad');
 * email.getValidation().isValid; // false
 * ```
 */
export function valueSchema<S extends StandardSchemaV1>(
	schema: S,
	defaultValue: StandardSchemaV1.InferInput<S>,
): ValueSchema<
	StandardSchemaV1.InferInput<S>,
	StandardSchemaV1.InferOutput<S>
> {
	return new ValueSchema(schema, defaultValue);
}

/**
 * Check if a value is a ValueSchema instance (used by the scope definition walker).
 * @internal
 */
export function isValueSchemaInstance(
	v: unknown,
): v is ValueSchema<unknown, unknown> {
	return typeof v === 'object' && v !== null && VALUE_SCHEMA_BRAND in v;
}
