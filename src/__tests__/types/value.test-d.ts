import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import type { Setter } from '../../core/types.js';

// --- value<T>() without default: T | undefined ---

const noDefault = value<string>();

expectTypeOf(noDefault.get()).toEqualTypeOf<string | undefined>();
expectTypeOf(noDefault.set).toBeCallableWith('hello');
expectTypeOf(noDefault.set).toBeCallableWith(
	(_prev: string | undefined) => 'hello',
);

// --- value<T>(default) with default: T ---

const withDefault = value<string>('hello');

expectTypeOf(withDefault.get()).toEqualTypeOf<string>();
expectTypeOf(withDefault.set).toBeCallableWith('world');
expectTypeOf(withDefault.set).toBeCallableWith((_prev: string) => 'world');

// --- .pipe() same-type preserves type ---

const piped = value<string>('').pipe((v) => v.trim());
expectTypeOf(piped.get()).toEqualTypeOf<string>();

const multiPiped = value<string>('')
	.pipe((v) => v.trim())
	.pipe((v) => v.toLowerCase());
expectTypeOf(multiPiped.get()).toEqualTypeOf<string>();

// --- .pipe() type-changing: In stays, Out changes ---

const typeChanging = value<string>('42').pipe((v) => parseInt(v));
expectTypeOf(typeChanging.get()).toEqualTypeOf<number>();
// set() still accepts the original In type (string)
expectTypeOf(typeChanging.set).toBeCallableWith('100');

// Chained type change
const chained = value<string>('  42  ')
	.pipe((v) => v.trim())
	.pipe((v) => parseInt(v));
expectTypeOf(chained.get()).toEqualTypeOf<number>();
expectTypeOf(chained.set).toBeCallableWith('  100  ');

// --- .compareUsing() preserves the type ---

const compared = value<string>('hello').compareUsing((a, b) => a === b);
expectTypeOf(compared.get()).toEqualTypeOf<string>();

// compareUsing on type-changed value: comparator receives Out type
const comparedTypeChanged = value<string>('42')
	.pipe((v) => parseInt(v))
	.compareUsing((a, b) => a === b);
expectTypeOf(comparedTypeChanged.get()).toEqualTypeOf<number>();

// --- .subscribe() with prev value ---

const unsub = withDefault.subscribe((_value, _prev) => {});
expectTypeOf(unsub).toEqualTypeOf<() => void>();

withDefault.subscribe((current, previous) => {
	expectTypeOf(current).toEqualTypeOf<string>();
	expectTypeOf(previous).toEqualTypeOf<string>();
});

noDefault.subscribe((current, previous) => {
	expectTypeOf(current).toEqualTypeOf<string | undefined>();
	expectTypeOf(previous).toEqualTypeOf<string | undefined>();
});

// --- .use() returns [Out, Setter<In>] tuple ---

const useResult = withDefault.use();
expectTypeOf(useResult).toEqualTypeOf<[string, Setter<string>]>();

const useNoDefault = noDefault.use();
expectTypeOf(useNoDefault).toEqualTypeOf<
	[string | undefined, Setter<string | undefined>]
>();

// Type-changing: use() returns [Out, Setter<In>]
const useTypeChanged = value<string>('42')
	.pipe((v) => parseInt(v))
	.use();
expectTypeOf(useTypeChanged).toEqualTypeOf<[number, Setter<string>]>();

// --- value() infers type from default ---

const inferred = value(42);
expectTypeOf(inferred.get()).toEqualTypeOf<number>();

const inferredString = value('hello');
expectTypeOf(inferredString.get()).toEqualTypeOf<string>();
