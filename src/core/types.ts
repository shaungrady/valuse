/**
 * Returns `true` when two values should be considered equal.
 *
 * @remarks
 * Used in `.compareUsing()` to determine if a value update should trigger
 * subscribers or be skipped.
 *
 * @typeParam T - the type of the values being compared.
 */
export type Comparator<T> = (a: T, b: T) => boolean;

/**
 * A function that transforms a value before it is stored.
 *
 * @remarks
 * Supports type-changing transforms where the output type differs from the input.
 *
 * @typeParam In - the incoming value type.
 * @typeParam Out - the transformed value type (defaults to `In`).
 *
 * @param value - the value to transform.
 * @returns the transformed value.
 */
export type Transform<In, Out = In> = (value: In) => Out;

/**
 * A callback function to unsubscribe from a reactive source.
 *
 * @remarks
 * Returned by all `.subscribe()` methods and the `$subscribe()` method on scope instances.
 * Call this function to stop receiving updates.
 */
export type Unsubscribe = () => void;

/**
 * A setter function that accepts a direct value or a update function.
 *
 * @remarks
 * Usually returned as the second element of `.use()` tuples (React hooks).
 *
 * @typeParam T - the type of the value to set.
 */
export type Setter<T> = (value: T | ((prev: T) => T)) => void;

/**
 * A factory pipe descriptor. The `create` function is called once per value
 * instance and returns a writer that receives each incoming value. Cleanup
 * runs on destroy.
 *
 * @typeParam In - the incoming value type
 * @typeParam Out - the output value type (defaults to In)
 */
export interface PipeFactoryDescriptor<In, Out = In> {
	create: (context: {
		set: (value: Out) => void;
		onCleanup: (fn: () => void) => void;
	}) => (value: In) => void;
}

/**
 * A single step in a pipe chain. Either a synchronous transform or a factory
 * descriptor.
 */
export type PipeStep<In = unknown, Out = unknown> =
	| Transform<In, Out>
	| PipeFactoryDescriptor<In, Out>;

/**
 * A change record for onChange/beforeChange hooks.
 *
 * @typeParam T - the value type of the changed field
 */
export interface Change<T = unknown> {
	/** The scope node object reference for programmatic checks. */
	readonly scope: ScopeNode;
	/** Dot-separated path string for logging and pattern matching. */
	readonly path: string;
	/** The previous value. */
	readonly from: T;
	/** The new value. */
	readonly to: T;
}

/**
 * A scope node reference. Used as keys in `changesByScope` and as arguments
 * to `prevent()`. This is intentionally opaque; the actual type is the wrapper
 * object (FieldValue, grouping object, etc.) on the instance tree.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ScopeNode = {};
