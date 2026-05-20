import type { PipeFactoryDescriptor, Transform } from '../types.js';

// Shared pipe-step representation used by Value and ValueSchema.
// `kind: 'factory'` is only meaningful for Value (ValueSchema has no
// async/stateful pipe support), but keeping a single union here keeps the
// type system honest and avoids two parallel hierarchies.

export interface SyncPipeStep<In = unknown, Out = unknown> {
	kind: 'sync';
	transform: Transform<In, Out>;
}

export interface FactoryPipeStep<In = unknown, Out = unknown> {
	kind: 'factory';
	descriptor: PipeFactoryDescriptor<In, Out>;
}

export type InternalPipeStep = SyncPipeStep | FactoryPipeStep;

/**
 * An activated factory pipe — created by Value when a factory step is added.
 * `write` receives a value from upstream; `cleanups` are the teardown
 * functions registered via the factory's `onCleanup`.
 */
export interface ActiveFactoryPipe {
	write: (value: unknown) => void;
	cleanups: (() => void)[];
}

/**
 * Apply every sync transform in a pipe step list, in order, to a starting
 * value. Factory steps are ignored — they are activated separately and handle
 * their own value flow.
 *
 * @internal
 */
export function applySyncSteps(
	steps: readonly InternalPipeStep[],
	value: unknown,
): unknown {
	let current = value;
	for (const step of steps) {
		if (step.kind === 'sync') {
			current = step.transform(current);
		}
	}
	return current;
}

/**
 * Apply a list of homogeneous transforms in order. Used by ValueMap and
 * ValueSet, which have a simpler pipe model than Value (no factory pipes —
 * every step is a same-shape `Transform<T>`).
 *
 * @internal
 */
export function applyTransforms<T>(
	transforms: readonly Transform<T>[],
	value: T,
): T {
	let current = value;
	for (const transform of transforms) {
		current = transform(current);
	}
	return current;
}
