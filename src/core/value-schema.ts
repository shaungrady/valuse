import { signal, type Signal } from './signal.js';
import { subscribeWithPrevious } from './utils/effect-helpers.js';
import { DisposerBag } from './utils/disposer-bag.js';
import {
	applySyncSteps,
	type InternalPipeStep,
} from './utils/pipe-internal.js';
import { applyBrand, hasBrand } from './utils/brand.js';
import type { Comparator, Transform, Unsubscribe, Setter } from './types.js';
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

/**
 * Run a Standard Schema validation and return a ValidationState.
 * @internal
 */
export function runValidation<In, Out>(
	schema: StandardSchemaV1,
	input: In,
): ValidationState<In, Out> {
	let result: ReturnType<StandardSchemaV1['~standard']['validate']>;
	try {
		result = schema['~standard'].validate(input);
	} catch (err) {
		// A throwing validator (rather than one that returns issues) would
		// otherwise propagate out of `.set()`. Surface the failure through
		// the validation state instead — readers see `isValid: false` with
		// the throw message as an issue, and the value still gets stored.
		console.error('valuse: schema validator threw', err);
		return {
			isValid: false,
			value: input,
			issues: [{ message: err instanceof Error ? err.message : String(err) }],
		};
	}

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
	readonly #bag = new DisposerBag();

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
		applyBrand(this, VALUE_SCHEMA_BRAND);
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
		if (this.#bag.destroyed) return;
		const previous = this._signal.peek();
		const raw =
			typeof valueOrFn === 'function' ?
				(valueOrFn as (prev: In) => In)(previous)
			:	valueOrFn;

		// Apply sync pipe transforms
		const next = applySyncSteps(this._pipeSteps, raw) as In;

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
		return this.#bag.attach(
			subscribeWithPrevious(
				() => this._signal.value,
				() => this._signal.peek(),
				fn,
			),
		);
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
		const transformedInitial = transform(currentValue);
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
				this.set(valueOrFn);
			},
		];
	}

	/**
	 * Dispose all active subscriptions.
	 *
	 * After destroy, reads still return the last value, writes are no-ops,
	 * and existing subscribers stop firing. Idempotent.
	 */
	destroy(): void {
		this.#bag.destroy();
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
	return hasBrand(v, VALUE_SCHEMA_BRAND);
}
