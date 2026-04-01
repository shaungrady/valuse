import { expectTypeOf } from 'expect-type';
import { value } from '../../index.js';
import type { Setter } from '../../index.js';

// --- value<T>() without default: T | undefined ---

const noDefault = value<string>();

// .get() returns string | undefined when no default provided
expectTypeOf(noDefault.get()).toEqualTypeOf<string | undefined>();

// .set() accepts a string
expectTypeOf(noDefault.set).toBeCallableWith('hello');

// .set() also accepts a callback (prev is string | undefined)
expectTypeOf(noDefault.set).toBeCallableWith(
	(_prev: string | undefined) => 'hello',
);

// --- value<T>(default) with default: T ---

const withDefault = value<string>('hello');

// .get() returns string (not string | undefined) when default provided
expectTypeOf(withDefault.get()).toEqualTypeOf<string>();

// .set() accepts string
expectTypeOf(withDefault.set).toBeCallableWith('world');

// .set() callback receives string (not undefined)
expectTypeOf(withDefault.set).toBeCallableWith((_prev: string) => 'world');

// --- .pipe() preserves the type and is chainable ---

const piped = value<string>('').pipe((v) => v.trim());

// Still a Value<string> with default — .get() returns string
expectTypeOf(piped.get()).toEqualTypeOf<string>();

// Chaining multiple pipes
const multiPiped = value<string>('')
	.pipe((v) => v.trim())
	.pipe((v) => v.toLowerCase());
expectTypeOf(multiPiped.get()).toEqualTypeOf<string>();

// Pipe transform must be T => T
// @ts-expect-error - pipe transform must return same type
value<string>('').pipe((_v) => 42);

// --- .pipe() on value without default: transform receives T | undefined ---

const pipedNoDefault = value<string>().pipe((v) => v?.trim());
expectTypeOf(pipedNoDefault.get()).toEqualTypeOf<string | undefined>();

// --- .compareUsing() preserves the type and is chainable ---

const compared = value<string>('hello').compareUsing((a, b) => a === b);
expectTypeOf(compared.get()).toEqualTypeOf<string>();

// compareUsing on no-default: comparator receives string | undefined
const comparedNoDefault = value<string>().compareUsing((a, b) => a === b);
expectTypeOf(comparedNoDefault.get()).toEqualTypeOf<string | undefined>();

// Chaining pipe and compareUsing
const chained = value<string>('')
	.pipe((v) => v.trim())
	.compareUsing((a, b) => a === b);
expectTypeOf(chained.get()).toEqualTypeOf<string>();

// --- .subscribe() returns unsubscribe ---

const unsub = withDefault.subscribe((_v) => {});
expectTypeOf(unsub).toEqualTypeOf<() => void>();

// subscribe callback receives the value type
withDefault.subscribe((v) => {
	expectTypeOf(v).toEqualTypeOf<string>();
});

noDefault.subscribe((v) => {
	expectTypeOf(v).toEqualTypeOf<string | undefined>();
});

// --- .use() returns [T, Setter<T>] tuple ---

const useResult = withDefault.use();
expectTypeOf(useResult).toEqualTypeOf<[string, Setter<string>]>();

const useNoDefault = noDefault.use();
expectTypeOf(useNoDefault).toEqualTypeOf<
	[string | undefined, Setter<string | undefined>]
>();

// --- value() infers type from default ---

const inferred = value(42);
expectTypeOf(inferred.get()).toEqualTypeOf<number>();

const inferredString = value('hello');
expectTypeOf(inferredString.get()).toEqualTypeOf<string>();

// --- number value with pipe ---

const clamped = value<number>(0).pipe((v) => Math.max(0, Math.min(100, v)));
expectTypeOf(clamped.get()).toEqualTypeOf<number>();
expectTypeOf(clamped.set).toBeCallableWith(50);
