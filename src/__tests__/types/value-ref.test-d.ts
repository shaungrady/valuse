import { expectTypeOf } from 'expect-type';
import { value } from '../../core/value.js';
import { valueRef, ValueRef } from '../../core/value-ref.js';
import { valueSet } from '../../core/value-set.js';
import { valueMap } from '../../core/value-map.js';

// ── Ref to Value ────────────────────────────────────────────────────

const name = value('Alice');
const nameRef = valueRef(name);
expectTypeOf(nameRef).toEqualTypeOf<ValueRef<string>>();
expectTypeOf(nameRef.get()).toEqualTypeOf<string>();

// ── Ref to ValueSet ─────────────────────────────────────────────────

const tags = valueSet(['a', 'b']);
const tagsRef = valueRef(tags);
expectTypeOf(tagsRef).toEqualTypeOf<ValueRef<Set<string>>>();
expectTypeOf(tagsRef.get()).toEqualTypeOf<Set<string>>();

// ── Ref to ValueMap ─────────────────────────────────────────────────

const scores = valueMap<string, number>([['alice', 95]]);
const scoresRef = valueRef(scores);
expectTypeOf(scoresRef).toEqualTypeOf<ValueRef<Map<string, number>>>();
expectTypeOf(scoresRef.get()).toEqualTypeOf<Map<string, number>>();

// ── Ref from factory ────────────────────────────────────────────────

const factoryRef = valueRef(() => value('factory'));
expectTypeOf(factoryRef.factory).not.toBeUndefined();

// ── Ref to plain reactive source ────────────────────────────────────

const plainRef = valueRef({ get: () => 42 });
expectTypeOf(plainRef).toEqualTypeOf<ValueRef<number>>();
expectTypeOf(plainRef.get()).toEqualTypeOf<number>();
