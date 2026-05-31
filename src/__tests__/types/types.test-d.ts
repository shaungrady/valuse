import { expectTypeOf } from 'expect-type';
import type {
	Comparator,
	Transform,
	Unsubscribe,
	Setter,
	PipeFactoryDescriptor,
	PipeStep,
	Change,
	ScopeNode,
} from '../../core/types.js';
import { batchSets } from '../../core/signal.js';

// --- Transform ---

// Same-type transform
expectTypeOf<Transform<string>>().toEqualTypeOf<(value: string) => string>();

// Type-changing transform
expectTypeOf<Transform<string, number>>().toEqualTypeOf<
	(value: string) => number
>();

// --- Comparator ---

expectTypeOf<Comparator<string>>().toEqualTypeOf<
	(a: string, b: string) => boolean
>();

// --- Unsubscribe ---

expectTypeOf<Unsubscribe>().toEqualTypeOf<() => void>();

// --- Setter ---

// Accepts direct value
expectTypeOf<Setter<number>>().toBeCallableWith(5);

// Accepts callback
expectTypeOf<Setter<number>>().toBeCallableWith((prev: number) => prev + 1);

// --- PipeFactoryDescriptor (actor model) ---

// Same-type factory: create(host) returns an actor with onWrite.
expectTypeOf<PipeFactoryDescriptor<string>>().toMatchTypeOf<{
	create: (host: {
		set: (value: string) => void;
		onCleanup: (fn: () => void) => void;
		signal: AbortSignal;
		deferBy: (ms: number) => Promise<void>;
	}) => { onWrite: (value: string) => void };
}>();

// Type-changing factory: host.set takes the output type.
expectTypeOf<PipeFactoryDescriptor<string, number>>().toMatchTypeOf<{
	create: (host: {
		set: (value: number) => void;
		onCleanup: (fn: () => void) => void;
		signal: AbortSignal;
		deferBy: (ms: number) => Promise<void>;
	}) => { onWrite: (value: string) => void };
}>();

// --- PipeStep ---

// Can be a transform
expectTypeOf<Transform<string, number>>().toMatchTypeOf<
	PipeStep<string, number>
>();

// Can be a factory
expectTypeOf<PipeFactoryDescriptor<string, number>>().toMatchTypeOf<
	PipeStep<string, number>
>();

// --- Change ---

expectTypeOf<Change<string>>().toMatchTypeOf<{
	readonly scope: ScopeNode;
	readonly path: string;
	readonly from: string;
	readonly to: string;
}>();

// Default type param is unknown
expectTypeOf<Change>().toMatchTypeOf<{
	readonly scope: ScopeNode;
	readonly path: string;
	readonly from: unknown;
	readonly to: unknown;
}>();

// --- batchSets ---

expectTypeOf(batchSets).toBeFunction();
