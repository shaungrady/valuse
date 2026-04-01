import { expectTypeOf } from 'expect-type';
import { valueSet } from '../../index.js';
import type { Unsubscribe } from '../../index.js';

// --- valueSet<T>() without initial: empty set ---

const noInit = valueSet<string>();

// .get() returns Set<string>
expectTypeOf(noInit.get()).toEqualTypeOf<Set<string>>();

// --- valueSet<T>(initial) with initial values ---

const withInit = valueSet<string>(['admin', 'active']);
expectTypeOf(withInit.get()).toEqualTypeOf<Set<string>>();

// --- .set() accepts a new Set (replacement) ---

expectTypeOf(withInit.set).toBeCallableWith(new Set(['a', 'b']));

// --- .set() accepts a draft callback ---

expectTypeOf(withInit.set).toBeCallableWith((_draft: Set<string>) => {});

// --- .pipe() preserves type and is chainable ---

const piped = valueSet<string>().pipe(
	(s) => new Set([...s].map((t) => t.toLowerCase())),
);
expectTypeOf(piped.get()).toEqualTypeOf<Set<string>>();

// Pipe transform is Set<T> => Set<T>
// @ts-expect-error - pipe transform must return Set<T>
valueSet<string>().pipe((_s) => [1, 2, 3]);

// --- .compareUsing() preserves type and is chainable ---

const compared = valueSet<string>().compareUsing((a, b) => a.size === b.size);
expectTypeOf(compared.get()).toEqualTypeOf<Set<string>>();

// Chain pipe + compareUsing
const chained = valueSet<string>()
	.pipe((s) => new Set([...s].map((t) => t.toLowerCase())))
	.compareUsing((a, b) => a.size === b.size);
expectTypeOf(chained.get()).toEqualTypeOf<Set<string>>();

// --- .subscribe() returns unsubscribe ---

const unsub = withInit.subscribe((_v) => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();

// subscribe callback receives Set<T>
withInit.subscribe((v) => {
	expectTypeOf(v).toEqualTypeOf<Set<string>>();
});

// --- .use() returns [Set<T>, setter] ---

const [current, set] = withInit.use();
expectTypeOf(current).toEqualTypeOf<Set<string>>();
expectTypeOf(set).toBeCallableWith(new Set(['a']));
expectTypeOf(set).toBeCallableWith((_draft: Set<string>) => {});
