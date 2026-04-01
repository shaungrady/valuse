import { expectTypeOf } from 'expect-type';
import { valueMap } from '../../index.js';
import type { Unsubscribe } from '../../index.js';

// --- valueMap<K, V>() creates an empty map ---

const empty = valueMap<string, number>();
expectTypeOf(empty.get()).toEqualTypeOf<Map<string, number>>();

// --- valueMap<K, V>(entries) with initial entries ---

const withInit = valueMap<string, number>([
	['alice', 95],
	['bob', 82],
]);
expectTypeOf(withInit.get()).toEqualTypeOf<Map<string, number>>();

// --- .get(key) returns V | undefined ---

expectTypeOf(withInit.get('alice')).toEqualTypeOf<number | undefined>();

// --- .set() accepts a new Map (replacement) ---

expectTypeOf(withInit.set).toBeCallableWith(new Map([['alice', 100]]));

// --- .set() accepts a draft callback ---

expectTypeOf(withInit.set).toBeCallableWith(
	(_draft: Map<string, number>) => {},
);

// --- .pipe() preserves type and is chainable ---

const piped = valueMap<string, number>().pipe(
	(m) => new Map([...m].map(([k, v]) => [k, Math.max(0, v)])),
);
expectTypeOf(piped.get()).toEqualTypeOf<Map<string, number>>();

// @ts-expect-error - pipe transform must return Map<K, V>
valueMap<string, number>().pipe((_m) => [1, 2, 3]);

// --- .compareUsing() preserves type and is chainable ---

const compared = valueMap<string, number>().compareUsing(
	(a, b) => a.size === b.size,
);
expectTypeOf(compared.get()).toEqualTypeOf<Map<string, number>>();

// --- .subscribe() returns unsubscribe ---

const unsub = withInit.subscribe((_v) => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();

withInit.subscribe((v) => {
	expectTypeOf(v).toEqualTypeOf<Map<string, number>>();
});

// --- .use() returns [Map<K,V>, setter] ---

const [current, set] = withInit.use();
expectTypeOf(current).toEqualTypeOf<Map<string, number>>();
expectTypeOf(set).toBeCallableWith(new Map([['alice', 100]]));
expectTypeOf(set).toBeCallableWith((_draft: Map<string, number>) => {});

// --- .use(key) returns [value, setter] tuple ---

const [aliceScore, setAlice] = withInit.use('alice');
expectTypeOf(aliceScore).toEqualTypeOf<number | undefined>();
expectTypeOf(setAlice).toBeCallableWith(100);

// --- .useKeys() returns array of keys ---

const keys = withInit.useKeys();
expectTypeOf(keys).toEqualTypeOf<string[]>();

// --- Map-like methods ---

expectTypeOf(withInit.size).toEqualTypeOf<number>();
expectTypeOf(withInit.has('alice')).toEqualTypeOf<boolean>();
expectTypeOf(withInit.keys()).toEqualTypeOf<string[]>();
expectTypeOf(withInit.values()).toEqualTypeOf<number[]>();
expectTypeOf(withInit.entries()).toEqualTypeOf<[string, number][]>();
expectTypeOf(withInit.delete('alice')).toEqualTypeOf<boolean>();
