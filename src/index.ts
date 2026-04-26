// --- Core primitives ---
export { value, Value, isValueInstance } from './core/value.js';
export {
	valueSchema,
	ValueSchema,
	isValueSchemaInstance,
} from './core/value-schema.js';
export type {
	ValidationState,
	SyncStandardSchema,
} from './core/value-schema.js';
export { valueScope, ScopeTemplate } from './core/value-scope.js';
export type { ScopeConfig } from './core/value-scope.js';
export { valueArray, ValueArray } from './core/value-array.js';
export { valueRef, ValueRef } from './core/value-ref.js';
export { valuePlain, ValuePlain } from './core/value-plain.js';
export { valueSet, ValueSet } from './core/value-set.js';
export { valueMap, ValueMap } from './core/value-map.js';
export { ScopeMap } from './core/scope-map.js';
export { batchSets } from './core/signal.js';

// --- Instance field types and type guards ---
export {
	FieldValue,
	FieldValueSchema,
	FieldValuePlain,
	FieldDerived,
	FieldAsyncDerived,
	isValue,
	isSchema,
	isPlain,
	isComputed,
	isScope,
} from './core/field-value.js';

// --- Field type aliases for collections and refs ---
// These are the standalone classes themselves; the aliases provide
// a consistent Field* naming convention for annotating component props.
export type { ValueArray as FieldValueArray } from './core/value-array.js';
export type { ValueSet as FieldValueSet } from './core/value-set.js';
export type { ValueMap as FieldValueMap } from './core/value-map.js';
export type { ValueRef as FieldValueRef } from './core/value-ref.js';

// --- Types ---
export type {
	Comparator,
	Transform,
	Unsubscribe,
	Setter,
	PipeFactoryDescriptor,
	PipeStep,
	Change,
	ScopeNode,
} from './core/types.js';
export type { AsyncState } from './core/async-state.js';

// --- Scope type utilities ---
export type {
	ScopeInstance,
	ValueInputOf,
	SnapshotOf,
	MapDefinition,
	ExtendDef,
	ScopeDollarMethods,
} from './core/scope-types.js';

// --- React bridge ---
export { installReact, getReactHooks } from './core/react-bridge.js';
