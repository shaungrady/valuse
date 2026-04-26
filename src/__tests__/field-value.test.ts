import { describe, it, expect } from 'vitest';
import { InstanceStore } from '../core/instance-store.js';
import {
	FieldValue,
	FieldValuePlain,
	FieldValueSchema,
	FieldDerived,
	FieldAsyncDerived,
	DerivationWrap,
	isValue,
	isPlain,
	isSchema,
	isComputed,
	isScope,
	brandAsScope,
} from '../core/field-value.js';
import type { ScopeDefinitionMeta, SlotMeta } from '../core/slot-meta.js';

function makeSlotMeta(overrides: Partial<SlotMeta> = {}): SlotMeta {
	return {
		path: 'field',
		fieldName: 'field',
		kind: 'value',
		pipeline: null,
		comparator: null,
		defaultValue: undefined,
		ancestorGroupIndices: [],
		derivationFn: null,
		schema: null,
		readonly: false,
		...overrides,
	};
}

function makeStore(
	slots: SlotMeta[],
	initialValues: Map<number, unknown> = new Map(),
): InstanceStore {
	const definition: ScopeDefinitionMeta = {
		slotCount: slots.length,
		slots,
		groups: [
			{
				path: '',
				fieldName: '',
				index: 0,
				ancestorGroupIndices: [],
				childSlots: slots.map((_, i) => i),
				childGroups: [],
			},
		],
		staticEntries: new Map(),
		pathToSlot: new Map(slots.map((s, i) => [s.path, i])),
		pathToGroup: new Map(),
		refEntries: new Map(),
	};
	return new InstanceStore(definition, initialValues);
}

describe('FieldValue', () => {
	it('delegates get() to the store', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldValue<string>(store, 0);
		expect(field.get()).toBe('Alice');
	});

	it('delegates set() to the store', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldValue<string>(store, 0);
		field.set('Bob');
		expect(field.get()).toBe('Bob');
	});

	it('supports callback set()', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'count' })],
			new Map([[0, 10]]),
		);
		const field = new FieldValue<number>(store, 0);
		field.set((prev) => prev + 5);
		expect(field.get()).toBe(15);
	});

	it('delegates subscribe() to the store', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldValue<string>(store, 0);
		const calls: [string, string][] = [];
		field.subscribe((value, previous) => calls.push([value, previous]));
		field.set('Bob');
		expect(calls).toEqual([['Bob', 'Alice']]);
	});
});

describe('FieldDerived', () => {
	it('delegates get() to the store', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'fullName', kind: 'derived' })],
			new Map([[0, 'Alice Smith']]),
		);
		const field = new FieldDerived<string>(store, 0);
		expect(field.get()).toBe('Alice Smith');
	});

	it('has no set() method', () => {
		const field = new FieldDerived<string>({} as InstanceStore, 0);
		expect('set' in field).toBe(false);
	});

	it('delegates subscribe() to the store', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'fullName', kind: 'derived' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldDerived<string>(store, 0);
		const calls: string[] = [];
		field.subscribe((value) => calls.push(value));
		// Simulate a derivation update by writing directly to the signal
		store.signals[0]!.value = 'Bob';
		expect(calls).toEqual(['Bob']);
	});
});

describe('FieldAsyncDerived', () => {
	it('get() returns undefined initially', () => {
		const store = makeStore([
			makeSlotMeta({ path: 'profile', kind: 'asyncDerived' }),
		]);
		const field = new FieldAsyncDerived<{ name: string }>(store, 0);
		expect(field.get()).toBeUndefined();
	});

	it('getAsync() returns initial async state', () => {
		const store = makeStore([
			makeSlotMeta({ path: 'profile', kind: 'asyncDerived' }),
		]);
		const field = new FieldAsyncDerived<{ name: string }>(store, 0);
		const state = field.getAsync();
		expect(state.status).toBe('unset');
		expect(state.value).toBeUndefined();
		expect(state.hasValue).toBe(false);
	});
});

describe('DerivationWrap', () => {
	it('use() reads with tracking (signal.value)', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const wrap = new DerivationWrap(store, 0);
		// Just verify it returns the value; tracking is tested via computed() in scope tests
		expect(wrap.use()).toBe('Alice');
	});

	it('get() reads without tracking (peek)', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const wrap = new DerivationWrap(store, 0);
		expect(wrap.get()).toBe('Alice');
	});
});

describe('type guards', () => {
	it('isValue() identifies FieldValue instances', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldValue<string>(store, 0);
		expect(isValue(field)).toBe(true);
		expect(isValue({})).toBe(false);
		expect(isValue(null)).toBe(false);
		expect(isValue('hello')).toBe(false);
	});

	it('isComputed() identifies FieldDerived instances', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'fullName', kind: 'derived' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldDerived<string>(store, 0);
		expect(isComputed(field)).toBe(true);
		expect(isComputed({})).toBe(false);
	});

	it('isComputed() identifies FieldAsyncDerived instances', () => {
		const store = makeStore([
			makeSlotMeta({ path: 'profile', kind: 'asyncDerived' }),
		]);
		const field = new FieldAsyncDerived<string>(store, 0);
		expect(isComputed(field)).toBe(true);
	});

	it('isScope() identifies branded objects', () => {
		const instance: Record<string, unknown> = { firstName: 'test' };
		expect(isScope(instance)).toBe(false);
		brandAsScope(instance);
		expect(isScope(instance)).toBe(true);
	});

	it('isSchema() identifies FieldValueSchema instances', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'email', kind: 'schema' })],
			new Map([[0, 'a@b.com']]),
		);
		const field = new FieldValueSchema<string, string>(store, 0);
		expect(isSchema(field)).toBe(true);
		expect(isSchema({})).toBe(false);
		expect(isSchema(null)).toBe(false);
	});

	it('isPlain() identifies FieldValuePlain instances', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'note', kind: 'plain' })],
			new Map([[0, 'hi']]),
		);
		const field = new FieldValuePlain<string>(store, 0);
		expect(isPlain(field)).toBe(true);
		expect(isPlain({})).toBe(false);
	});
});

describe('FieldValue.use() outside React', () => {
	it('returns [value, setter] without React', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldValue<string>(store, 0);
		const result = field.use();
		expect(result).toHaveLength(2);
		expect(result[0]).toBe('Alice');
		expect(typeof result[1]).toBe('function');
	});

	it('setter from use() updates the value', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'name' })],
			new Map([[0, 'Alice']]),
		);
		const field = new FieldValue<string>(store, 0);
		const [, setter] = field.use();
		setter('Bob');
		expect(field.get()).toBe('Bob');
	});
});

describe('FieldValueSchema outside React', () => {
	it('getValidation() returns validation state', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'email', kind: 'schema' })],
			new Map([[0, 'test@test.com']]),
		);
		const field = new FieldValueSchema<string, string>(store, 0);
		const validation = field.getValidation();
		expect(validation.isValid).toBe(true);
	});

	it('useValidation() returns [value, setter, validation] without React', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'email', kind: 'schema' })],
			new Map([[0, 'test@test.com']]),
		);
		const field = new FieldValueSchema<string, string>(store, 0);
		const result = field.useValidation();
		expect(result).toHaveLength(3);
		expect(result[0]).toBe('test@test.com');
		expect(typeof result[1]).toBe('function');
		expect(result[2].isValid).toBe(true);
	});
});

describe('FieldDerived.use() outside React', () => {
	it('returns [value] without React', () => {
		const store = makeStore(
			[makeSlotMeta({ path: 'full', kind: 'derived' })],
			new Map([[0, 'Alice Smith']]),
		);
		const field = new FieldDerived<string>(store, 0);
		const result = field.use();
		expect(result).toEqual(['Alice Smith']);
	});
});

describe('FieldAsyncDerived.useAsync() outside React', () => {
	it('returns [value, asyncState] without React', () => {
		const store = makeStore([
			makeSlotMeta({ path: 'data', kind: 'asyncDerived' }),
		]);
		const field = new FieldAsyncDerived<string>(store, 0);
		const result = field.useAsync();
		expect(result).toHaveLength(2);
		expect(result[0]).toBeUndefined();
		expect(result[1].status).toBe('unset');
	});
});
