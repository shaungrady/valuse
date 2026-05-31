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
 * Host handed to a factory pipe's `create`. Provides the downstream
 * `set`, lifetime `onCleanup`, a destroy `signal`, and a host-tracked
 * `deferBy` for flushable timers. See `docs/proposals/flush-pipeline.md`.
 *
 * @typeParam Out - the output value type committed downstream.
 */
export interface PipeHost<Out> {
	/** Commit a value downstream (to the next pipe step, or the signal). */
	set: (value: Out) => void;
	/** Register teardown that runs when the host value is destroyed. */
	onCleanup: (fn: () => void) => void;
	/** Aborts when the host value is destroyed. */
	signal: AbortSignal;
	/**
	 * Abortable + flushable sleep, governed by the host's destroy signal.
	 * Host-tracked: each call is registered so the actor's default
	 * `pendingPromise` / `flush` behavior covers it.
	 */
	deferBy: (ms: number) => Promise<void>;
}

/**
 * A factory pipe instance ("actor"). `onWrite` handles each upstream
 * write; the actor holds its own state across writes. A new write does
 * not abort prior in-flight work, so accumulating pipes (throttle,
 * batch, scan) keep their state.
 *
 * @typeParam In - the incoming value type.
 */
export interface PipeActor<In> {
	/** Handle one upstream write. */
	onWrite(value: In): void;
	/**
	 * In-flight work, or null when idle. Optional — defaults to the
	 * host-tracked `deferBy` calls. Override for work the host can't see
	 * (a raw `fetch`, an external promise).
	 */
	pendingPromise?: Promise<void> | null;
	/**
	 * Expedite pending work. Optional — defaults to flushing host-tracked
	 * `deferBy` calls.
	 */
	flush?(): void;
}

/**
 * A factory pipe descriptor. `create(host)` is called once per value
 * instance and returns a {@link PipeActor}.
 *
 * @typeParam In - the incoming value type
 * @typeParam Out - the output value type (defaults to In)
 */
export interface PipeFactoryDescriptor<In, Out = In> {
	create(host: PipeHost<Out>): PipeActor<In>;
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
