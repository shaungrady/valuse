import { expectTypeOf } from 'expect-type';
import { value, Value } from '../../core/value.js';
import { valueScope, ScopeTemplate } from '../../core/value-scope.js';
import { withHistory } from '../../middleware/history.js';
import type { HistoryInstance } from '../../middleware/history.js';
import { withDevtools } from '../../middleware/devtools.js';
import { withPersistence } from '../../middleware/persistence/persistence.js';
import { localStorageAdapter } from '../../middleware/persistence/local-storage-adapter.js';
import type { FieldValue } from '../../core/field-value.js';

const base = valueScope({ text: value<string>('') });

// `withHistory(base)` extends `ScopeTemplate<Def>` so it composes downstream.
const histTpl = withHistory(base);
expectTypeOf(histTpl).toMatchTypeOf<
	ScopeTemplate<{ text: Value<string, string> }>
>();

// `.create()` narrows the return to include `HistoryInstance`.
const histInst = histTpl.create();
expectTypeOf(histInst.$undo).toEqualTypeOf<() => void>();
expectTypeOf(histInst.$redo).toEqualTypeOf<() => void>();
expectTypeOf(histInst.$canUndo).toBeBoolean();
expectTypeOf(histInst.$canRedo).toBeBoolean();
expectTypeOf(histInst.$clearHistory).toEqualTypeOf<() => void>();
// Base fields still typed correctly.
expectTypeOf(histInst.text).toEqualTypeOf<FieldValue<string, string>>();

// Composition: withPersistence(withHistory(base)) must preserve the
// HistoryInstance augmentation on `.create()`.
const persistedHist = withPersistence(withHistory(base), {
	key: 'test',
	adapter: localStorageAdapter,
});
const persistedInst = persistedHist.create();
expectTypeOf(persistedInst.$undo).toEqualTypeOf<() => void>();
expectTypeOf(persistedInst.$canUndo).toBeBoolean();
expectTypeOf(persistedInst.text).toEqualTypeOf<FieldValue<string, string>>();

// Composition: withDevtools(withPersistence(withHistory(...))) preserves
// through the full stack.
const fullStack = withDevtools(
	withPersistence(withHistory(base), {
		key: 'test',
		adapter: localStorageAdapter,
	}),
	{ name: 'test' },
);
const stackedInst = fullStack.create();
expectTypeOf(stackedInst.$undo).toEqualTypeOf<() => void>();
expectTypeOf(stackedInst.$canUndo).toBeBoolean();

// Order shouldn't matter for type preservation either:
// withHistory(...) inside withDevtools alone.
const dt = withDevtools(withHistory(base), { name: 'test' });
expectTypeOf(dt.create().$undo).toEqualTypeOf<() => void>();

// And a plain non-history template under withPersistence still works (no
// history augmentation, just the base instance shape).
const plainPersisted = withPersistence(base, {
	key: 'test',
	adapter: localStorageAdapter,
});
const plainInst = plainPersisted.create();
expectTypeOf(plainInst.text).toEqualTypeOf<FieldValue<string, string>>();
// @ts-expect-error - plain base has no HistoryInstance methods
expectTypeOf<typeof plainInst.$undo>().toBeAny();

// HistoryInstance is exported so consumers can write helpers typed against it.
expectTypeOf<HistoryInstance>().toMatchTypeOf<{
	$undo: () => void;
	$redo: () => void;
	$canUndo: boolean;
	$canRedo: boolean;
	$clearHistory: () => void;
}>();
