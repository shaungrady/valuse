import { expectTypeOf } from 'expect-type';
import { value, type Value } from '../../core/value.js';
import { valueScope, type ScopeTemplate } from '../../core/value-scope.js';
import type { AugmentedScopeTemplate } from '../../core/augmented-template.js';
import { withHistory } from '../../middleware/history.js';
import type {
	HistoryInstance,
	HistoryTemplate,
} from '../../middleware/history.js';

type CounterDef = { count: Value<number, number> };
const base = valueScope({ count: value(0) });

// ── AugmentedScopeTemplate is assignable to the base ScopeTemplate ───

declare const aug: AugmentedScopeTemplate<CounterDef, { foo: () => void }>;
expectTypeOf(aug).toMatchTypeOf<ScopeTemplate<CounterDef>>();
// create() carries the Ext members, alongside the base instance surface.
expectTypeOf(aug.create().foo).toEqualTypeOf<() => void>();
expectTypeOf(aug.create().count.get()).toEqualTypeOf<number>();
// createMap entries carry the Ext too.
expectTypeOf(aug.createMap().get(1)!.foo).toEqualTypeOf<() => void>();

// ── HistoryTemplate is now an alias over AugmentedScopeTemplate ───────

expectTypeOf<HistoryTemplate<CounterDef>>().toEqualTypeOf<
	AugmentedScopeTemplate<CounterDef, HistoryInstance>
>();

// ── withHistory over a plain template → augmented with HistoryInstance ─

const h = withHistory(base);
expectTypeOf(h).toMatchTypeOf<ScopeTemplate<CounterDef>>();
const hi = h.create();
expectTypeOf(hi.$undo).toEqualTypeOf<() => void>();
expectTypeOf(hi.$canUndo).toBeBoolean();
expectTypeOf(hi.count.get()).toEqualTypeOf<number>();

// ── withHistory is generic over INCOMING Ext: composing over an already-
//    augmented template preserves the prior augmentation. ──

declare function withFoo<Def extends Record<string, unknown>, InExt = unknown>(
	t: AugmentedScopeTemplate<Def, InExt>,
): AugmentedScopeTemplate<Def, InExt & { foo: () => void }>;

const composed = withHistory(withFoo(base));
const ci = composed.create();
expectTypeOf(ci.foo).toEqualTypeOf<() => void>(); // prior Ext preserved
expectTypeOf(ci.$undo).toEqualTypeOf<() => void>(); // history Ext added
expectTypeOf(ci.count.get()).toEqualTypeOf<number>();
