import { expectTypeOf } from 'expect-type';
import { value, Value } from '../../core/value.js';
import { valueRef, ValueRef } from '../../core/value-ref.js';
import { valueSet, ValueSet } from '../../core/value-set.js';
import { valueMap, ValueMap } from '../../core/value-map.js';
import { valueScope } from '../../core/value-scope.js';
import type { FieldValue } from '../../core/field-value.js';

// ── Ref to Value: source type is preserved ──────────────────────────

const name = value('Alice');
const nameRef = valueRef(name);
expectTypeOf(nameRef).toEqualTypeOf<ValueRef<Value<string, string>>>();
// `.get()` resolves to the Value's output type.
expectTypeOf(nameRef.get()).toEqualTypeOf<string>();
// The underlying source is the Value itself, not the unwrapped Out.
expectTypeOf(nameRef.source).toEqualTypeOf<Value<string, string>>();

// ── Ref to ValueSet ─────────────────────────────────────────────────

const tags = valueSet(['a', 'b']);
const tagsRef = valueRef(tags);
expectTypeOf(tagsRef).toEqualTypeOf<ValueRef<ValueSet<string>>>();
expectTypeOf(tagsRef.get()).toEqualTypeOf<Set<string>>();
expectTypeOf(tagsRef.source).toEqualTypeOf<ValueSet<string>>();

// ── Ref to ValueMap ─────────────────────────────────────────────────

const scores = valueMap<string, number>([['alice', 95]]);
const scoresRef = valueRef(scores);
expectTypeOf(scoresRef).toEqualTypeOf<ValueRef<ValueMap<string, number>>>();
expectTypeOf(scoresRef.get()).toEqualTypeOf<Map<string, number>>();
expectTypeOf(scoresRef.source).toEqualTypeOf<ValueMap<string, number>>();

// ── Ref to a scope instance: source type is the instance ────────────

const settings = valueScope({
	theme: value<'light' | 'dark'>('light'),
});
const globalSettings = settings.create();
const settingsRef = valueRef(globalSettings);
// `.source` carries the scope instance type, so consumers can reach into
// fields with `.use()` / `.get()`.
expectTypeOf(settingsRef.source.theme).toEqualTypeOf<
	FieldValue<'light' | 'dark', 'light' | 'dark'>
>();

// ── Factory ref: source is the factory, .get() returns its return ───

const factoryRef = valueRef(() => value('factory'));
expectTypeOf(factoryRef.factory).not.toBeUndefined();
expectTypeOf(factoryRef.source).toEqualTypeOf<() => Value<string, string>>();
expectTypeOf(factoryRef.get()).toEqualTypeOf<Value<string, string>>();

// ── Ref to a plain reactive source ──────────────────────────────────

const plainRef = valueRef({ get: () => 42 });
expectTypeOf(plainRef.get()).toEqualTypeOf<number>();

// ── MapEntry unwrapping on a scope instance ─────────────────────────
// The point: on an instance, a `valueRef` field IS the resolved source,
// NOT a ValueRef wrapper. The type system must reflect that.

const widget = valueScope({
	label: value<string>(),
	user: valueRef(name),
	tags: valueRef(tags),
	settings: valueRef(globalSettings),
});
const widgetInstance = widget.create();

// `user` is the underlying Value, not a ValueRef wrapper.
expectTypeOf(widgetInstance.user).toEqualTypeOf<Value<string, string>>();
// `tags` is the underlying ValueSet.
expectTypeOf(widgetInstance.tags).toEqualTypeOf<ValueSet<string>>();
// `settings` is the scope instance with `.theme` reachable.
expectTypeOf(widgetInstance.settings.theme).toEqualTypeOf<
	FieldValue<'light' | 'dark', 'light' | 'dark'>
>();

// ── Factory refs: instance field is the factory's return ────────────

const column = valueScope({ id: value<string>() });
const board = valueScope({
	boardId: value<string>(),
	columns: valueRef(() => column.createMap()),
});
const boardInstance = board.create();

// `columns` is the ScopeMap itself, with all its methods. ScopeMap methods
// that ValueRef doesn't have must be callable through the instance field.
expectTypeOf(boardInstance.columns).toHaveProperty('set');
expectTypeOf(boardInstance.columns).toHaveProperty('useKeys');
expectTypeOf(boardInstance.columns).toHaveProperty('delete');
expectTypeOf(boardInstance.columns.size).toBeNumber();

// Calling `.get()` with no args used to be allowed because the type was
// `ValueRef<...>` (which takes no args). The correct type is `ScopeMap`,
// whose `.get(key)` requires a key — so this is now a type error.
// @ts-expect-error - ScopeMap.get requires a key argument.
boardInstance.columns.get();
