import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import { valueScope } from '../../core/value-scope.js';
import type { ScopeMap } from '../../core/scope-map.js';
import type { ScopeInstance } from '../../core/scope-types.js';
import type { FieldValue } from '../../core/field-value.js';
import type { Unsubscribe } from '../../core/types.js';

// ── createMap() returns ScopeMap<K, Def> ────────────────────────────

const def = {
	name: value<string>(),
	score: value(0),
};

const userMap = valueScope(def).createMap<number>();
expectTypeOf(userMap).toMatchTypeOf<ScopeMap<number, typeof def>>();

// ── get() returns ScopeInstance<Def> | undefined ────────────────────

const instance = userMap.get(1);
expectTypeOf(instance).toEqualTypeOf<ScopeInstance<typeof def> | undefined>();

if (instance) {
	expectTypeOf(instance.name).toEqualTypeOf<
		FieldValue<string | undefined, string | undefined>
	>();
	expectTypeOf(instance.score).toEqualTypeOf<FieldValue<number, number>>();
	expectTypeOf(instance.$destroy).toEqualTypeOf<() => void>();
}

// ── set() accepts Partial<ValueInputOf<Def>> ────────────────────────

userMap.set(1, { name: 'Alice', score: 100 });
userMap.set(2, { name: 'Bob' });
userMap.set(3, {});

// ── keys/values/entries ─────────────────────────────────────────────

expectTypeOf(userMap.keys()).toEqualTypeOf<number[]>();
expectTypeOf(userMap.values()).toEqualTypeOf<ScopeInstance<typeof def>[]>();

// ── subscribe ───────────────────────────────────────────────────────

const unsub = userMap.subscribe(() => {});
expectTypeOf(unsub).toEqualTypeOf<Unsubscribe>();

// ── size ────────────────────────────────────────────────────────────

expectTypeOf(userMap.size).toEqualTypeOf<number>();

// ── has / delete ────────────────────────────────────────────────────

expectTypeOf(userMap.has(1)).toEqualTypeOf<boolean>();
expectTypeOf(userMap.delete(1)).toEqualTypeOf<boolean>();
