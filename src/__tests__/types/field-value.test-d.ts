import { expectTypeOf } from 'expect-type';
import {
	FieldValue,
	FieldDerived,
	FieldAsyncDerived,
	isValue,
	isComputed,
	isScope,
} from '../../core/field-value.js';
import type { AsyncState } from '../../core/async-state.js';
import type { Setter, Unsubscribe } from '../../core/types.js';

// --- FieldValue<In, Out> ---

declare const stringValue: FieldValue<string>;
expectTypeOf(stringValue.get()).toEqualTypeOf<string>();
expectTypeOf(stringValue.set).toBeCallableWith('hello');
expectTypeOf(stringValue.use()).toEqualTypeOf<[string, Setter<string>]>();

// Subscribe returns unsubscribe
expectTypeOf(stringValue.subscribe(() => {})).toEqualTypeOf<Unsubscribe>();

// Subscribe callback receives value and previous
stringValue.subscribe((value, previous) => {
	expectTypeOf(value).toEqualTypeOf<string>();
	expectTypeOf(previous).toEqualTypeOf<string>();
});

// --- FieldValue<string, number> (type-changing) ---

declare const typeChangedValue: FieldValue<string, number>;
expectTypeOf(typeChangedValue.get()).toEqualTypeOf<number>();
expectTypeOf(typeChangedValue.set).toBeCallableWith('42');
expectTypeOf(typeChangedValue.use()).toEqualTypeOf<[number, Setter<string>]>();

// --- FieldDerived<T> ---

declare const derived: FieldDerived<string>;
expectTypeOf(derived.get()).toEqualTypeOf<string>();
expectTypeOf(derived.use()).toEqualTypeOf<[string]>();
expectTypeOf(derived.subscribe(() => {})).toEqualTypeOf<Unsubscribe>();

// FieldDerived has no .set()
// @ts-expect-error — derived values cannot be set
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
derived.set;

// FieldDerived has .recompute()
expectTypeOf(derived.recompute).toBeFunction();

// --- FieldAsyncDerived<T> ---

declare const asyncDerived: FieldAsyncDerived<string>;
expectTypeOf(asyncDerived.get()).toEqualTypeOf<string | undefined>();
expectTypeOf(asyncDerived.getAsync()).toEqualTypeOf<AsyncState<string>>();
expectTypeOf(asyncDerived.useAsync()).toEqualTypeOf<
	[string | undefined, AsyncState<string>]
>();

// Inherits from FieldDerived
expectTypeOf(asyncDerived.subscribe(() => {})).toEqualTypeOf<Unsubscribe>();
expectTypeOf(asyncDerived.recompute).toBeFunction();

// --- Type guards ---

declare const unknown: unknown;

if (isValue(unknown)) {
	expectTypeOf(unknown).toMatchTypeOf<FieldValue<unknown>>();
}

if (isComputed(unknown)) {
	expectTypeOf(unknown).toMatchTypeOf<FieldDerived<unknown>>();
}

if (isScope(unknown)) {
	expectTypeOf(unknown).toMatchTypeOf<Record<string, unknown>>();
}
