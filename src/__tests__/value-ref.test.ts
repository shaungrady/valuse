import { describe, it, expect } from 'vitest';
import { value, valueRef, valueSet, valueMap, valueScope } from '../index.js';

describe('valueRef()', () => {
	it('reads the current value from the source', () => {
		const source = value(42);
		const ref = valueRef(source);
		expect(ref.get()).toBe(42);
	});

	it('tracks source changes', () => {
		const source = value('hello');
		const ref = valueRef(source);
		source.set('world');
		expect(ref.get()).toBe('world');
	});

	it('works with valueSet sources', () => {
		const source = valueSet<string>(['a', 'b']);
		const ref = valueRef(source);
		expect(ref.get()).toEqual(new Set(['a', 'b']));
	});

	it('works with valueMap sources', () => {
		const source = valueMap<string, number>([['x', 1]]);
		const ref = valueRef(source);
		expect(ref.get()).toEqual(new Map([['x', 1]]));
	});
});

describe('valueRef in scopes', () => {
	it('makes external state readable via get()', () => {
		const globalTags = valueSet<string>(['admin']);
		const scope = valueScope({
			name: value<string>(),
			tags: valueRef(globalTags),
		});
		const inst = scope.create({ name: 'Alice' });

		expect(inst.get('tags')).toEqual(new Set(['admin']));
	});

	it('refs are shared across all instances', () => {
		const shared = value(0);
		const scope = valueScope({
			local: value(0),
			shared: valueRef(shared),
		});

		const a = scope.create();
		const b = scope.create();

		shared.set(99);
		expect(a.get('shared')).toBe(99);
		expect(b.get('shared')).toBe(99);
	});

	it('derivations can read refs', () => {
		const multiplier = value(2);
		const scope = valueScope({
			count: value(5),
			multiplier: valueRef(multiplier),
			result: ({ use }) => use('count') * use('multiplier'),
		});
		const inst = scope.create();

		expect(inst.get('result')).toBe(10);
		multiplier.set(3);
		expect(inst.get('result')).toBe(15);
	});

	it('set() silently ignores ref keys at runtime', () => {
		const source = value('original');
		const scope = valueScope({
			name: value('Alice'),
			external: valueRef(source),
		});
		const inst = scope.create();

		// Runtime: set on a ref key does nothing (no signal for it)
		(inst as any).set('external', 'hacked');
		expect(inst.get('external')).toBe('original');
	});

	it('subscribe notifies when ref source changes', () => {
		const source = value(0);
		const scope = valueScope({
			x: value(1),
			shared: valueRef(source),
		});
		const inst = scope.create();

		const calls: number[] = [];
		inst.subscribe((get) => {
			calls.push(get('shared') as number);
		});

		source.set(42);
		expect(calls).toEqual([42]);
	});

	it('works with extend()', () => {
		const shared = value('base');
		const base = valueScope({
			ref: valueRef(shared),
		});
		const extended = base.extend({
			local: value(0),
			combined: ({ use }) => `${use('ref')}-${use('local')}`,
		});
		const inst = extended.create({ local: 5 });

		expect(inst.get('combined')).toBe('base-5');
		shared.set('updated');
		expect(inst.get('combined')).toBe('updated-5');
	});

	it('works with .createMap()', () => {
		const shared = value('global');
		const scope = valueScope({
			name: value<string>(),
			shared: valueRef(shared),
		});
		const coll = scope.createMap();
		coll.set('a', { name: 'Alice' });
		coll.set('b', { name: 'Bob' });

		expect(coll.get('a')!.get('shared')).toBe('global');
		expect(coll.get('b')!.get('shared')).toBe('global');

		shared.set('changed');
		expect(coll.get('a')!.get('shared')).toBe('changed');
		expect(coll.get('b')!.get('shared')).toBe('changed');
	});
});

describe('valueRef with factory function', () => {
	it('creates a per-instance source', () => {
		const scope = valueScope({
			name: value<string>(),
			items: valueRef(() => value([] as string[])),
		});
		const a = scope.create({ name: 'Alice' });
		const b = scope.create({ name: 'Bob' });

		// Each instance has its own items
		expect(a.get('items')).toEqual([]);
		expect(b.get('items')).toEqual([]);
		expect(a.get('items')).not.toBe(b.get('items'));
	});

	it('factory creates per-instance ScopeMap', () => {
		const item = valueScope({
			label: value<string>(),
		});
		const container = valueScope({
			name: value<string>(),
			items: valueRef(() => item.createMap()),
		});

		const a = container.create({ name: 'A' });
		const b = container.create({ name: 'B' });

		// Each gets its own map
		const mapA = a.get('items');
		const mapB = b.get('items');
		expect(mapA).not.toBe(mapB);

		mapA.set('x', { label: 'hello' });
		expect(mapA.get('x')?.get('label')).toBe('hello');
		expect(mapB.has('x')).toBe(false);
	});

	it('derivations can read factory-created refs', () => {
		const item = valueScope({
			label: value<string>(),
		});
		const container = valueScope({
			items: valueRef(() => item.createMap()),
			count: ({ use }) => use('items').size,
		});

		const inst = container.create();
		expect(inst.get('count')).toBe(0);
	});
});

describe('valueRef with ScopeMap', () => {
	it('returns the ScopeMap via get()', () => {
		const item = valueScope({ label: value<string>() });
		const itemMap = item.createMap();

		const scope = valueScope({
			items: valueRef(itemMap),
		});
		const inst = scope.create();

		expect(inst.get('items')).toBe(itemMap);
	});

	it('shared ScopeMap ref across instances', () => {
		const item = valueScope({ label: value<string>() });
		const itemMap = item.createMap();

		const scope = valueScope({
			name: value<string>(),
			items: valueRef(itemMap),
		});
		const a = scope.create({ name: 'A' });
		const b = scope.create({ name: 'B' });

		itemMap.set('x', { label: 'hello' });
		expect(a.get('items').get('x')?.get('label')).toBe('hello');
		expect(b.get('items').get('x')?.get('label')).toBe('hello');
	});

	it('derivations re-run when ScopeMap keys change', () => {
		const item = valueScope({ label: value<string>() });
		const itemMap = item.createMap();

		const scope = valueScope({
			items: valueRef(itemMap),
			count: ({ use }) => use('items').size,
		});
		const inst = scope.create();

		expect(inst.get('count')).toBe(0);
		itemMap.set('a', { label: 'hello' });
		expect(inst.get('count')).toBe(1);
		itemMap.set('b', { label: 'world' });
		expect(inst.get('count')).toBe(2);
		itemMap.delete('a');
		expect(inst.get('count')).toBe(1);
	});

	it('subscribe fires on ScopeMap key changes', () => {
		const item = valueScope({ label: value<string>() });
		const itemMap = item.createMap();

		const scope = valueScope({
			items: valueRef(itemMap),
			count: ({ use }) => use('items').size,
		});
		const inst = scope.create();

		const counts: number[] = [];
		inst.subscribe((get) => {
			counts.push(get('count') as number);
		});

		itemMap.set('a', { label: 'hello' });
		itemMap.set('b', { label: 'world' });
		expect(counts).toEqual([1, 2]);
	});

	it('factory-created ScopeMap also tracks key changes', () => {
		const item = valueScope({ label: value<string>() });

		const scope = valueScope({
			items: valueRef(() => item.createMap()),
			count: ({ use }) => use('items').size,
		});
		const inst = scope.create();

		expect(inst.get('count')).toBe(0);
		const map = inst.get('items');
		map.set('a', { label: 'hello' });
		expect(inst.get('count')).toBe(1);
	});

	it('ScopeMap subscription is cleaned up on destroy', () => {
		const item = valueScope({ label: value<string>() });
		const itemMap = item.createMap();

		const scope = valueScope({
			items: valueRef(itemMap),
			count: ({ use }) => use('items').size,
		});
		const inst = scope.create();

		expect(inst.get('count')).toBe(0);
		inst.destroy();
		itemMap.set('a', { label: 'hello' });
		// After destroy, the computed is inert — stale value is fine
		expect(inst.get('count')).toBe(0);
	});
});

describe('valueRef with ScopeMap + extend', () => {
	it('extended scope tracks ScopeMap key changes', () => {
		const item = valueScope({ label: value<string>() });
		const base = valueScope({
			items: valueRef(() => item.createMap()),
			count: ({ use }) => use('items').size,
		});
		const extended = base.extend({
			hasItems: ({ use }) => use('items').size > 0,
		});
		const inst = extended.create();

		expect(inst.get('hasItems')).toBe(false);
		inst.get('items').set('a', { label: 'hello' });
		expect(inst.get('hasItems')).toBe(true);
		expect(inst.get('count')).toBe(1);
	});
});

describe('valueRef factory with getSnapshot', () => {
	it('includes factory-created ScopeMap in snapshot', () => {
		const item = valueScope({ label: value<string>() });
		const scope = valueScope({
			name: value<string>('test'),
			items: valueRef(() => item.createMap()),
		});
		const inst = scope.create();
		const map = inst.get('items');
		map.set('a', { label: 'hello' });

		const snap = inst.getSnapshot();
		expect(snap.name).toBe('test');
		expect(snap.items).toBe(map);
	});
});

describe('valueRef with ScopeInstance', () => {
	it('returns the scope instance via get()', () => {
		const address = valueScope({
			street: value('123 Main'),
			city: value('NYC'),
		});
		const addrInst = address.create();
		const ref = valueRef(addrInst);

		expect(ref.get()).toBe(addrInst);
		expect(ref.get().get('street')).toBe('123 Main');
	});

	it('allows chained get() on the returned instance', () => {
		const address = valueScope({
			street: value('123 Main'),
			city: value('NYC'),
			full: ({ use }) => `${use('street')}, ${use('city')}`,
		});
		const addrInst = address.create();

		const person = valueScope({
			name: value<string>(),
			address: valueRef(addrInst),
		});
		const personInst = person.create({ name: 'Alice' });

		expect(personInst.get('address').get('full')).toBe('123 Main, NYC');
	});

	it('allows chained set() for side effects', () => {
		const address = valueScope({
			street: value('123 Main'),
			city: value('NYC'),
			full: ({ use }) => `${use('street')}, ${use('city')}`,
		});
		const addrInst = address.create();

		const person = valueScope({
			name: value<string>(),
			address: valueRef(addrInst),
		});
		const personInst = person.create({ name: 'Alice' });

		personInst.get('address').set('street', '456 Oak');
		expect(addrInst.get('street')).toBe('456 Oak');
		expect(personInst.get('address').get('full')).toBe('456 Oak, NYC');
	});

	it('derivations react to changes on the referenced scope', () => {
		const address = valueScope({
			street: value('123 Main'),
			city: value('NYC'),
			full: ({ use }) => `${use('street')}, ${use('city')}`,
		});
		const addrInst = address.create();

		const person = valueScope({
			name: value<string>(),
			address: valueRef(addrInst),
			label: ({ use }) => `${use('name')} @ ${use('address').get('full')}`,
		});
		const personInst = person.create({ name: 'Alice' });

		expect(personInst.get('label')).toBe('Alice @ 123 Main, NYC');

		// Mutate the address scope — person's derivation should update
		addrInst.set('street', '456 Oak');
		expect(personInst.get('label')).toBe('Alice @ 456 Oak, NYC');
	});

	it('subscribe notifies on changes to the referenced scope', () => {
		const address = valueScope({
			street: value('Main St'),
			city: value('NYC'),
		});
		const addrInst = address.create();

		const person = valueScope({
			name: value<string>(),
			address: valueRef(addrInst),
			summary: ({ use }) => `${use('name')} on ${use('address').get('street')}`,
		});
		const personInst = person.create({ name: 'Alice' });

		const calls: string[] = [];
		personInst.subscribe((get) => {
			calls.push(get('summary') as string);
		});

		addrInst.set('street', 'Oak Ave');
		expect(calls).toEqual(['Alice on Oak Ave']);
	});

	it('shared scope ref across multiple instances', () => {
		const config = valueScope({
			theme: value('dark'),
			lang: value('en'),
		});
		const configInst = config.create();

		const widget = valueScope({
			label: value<string>(),
			config: valueRef(configInst),
		});

		const a = widget.create({ label: 'Button' });
		const b = widget.create({ label: 'Input' });

		expect(a.get('config').get('theme')).toBe('dark');
		expect(b.get('config').get('theme')).toBe('dark');

		configInst.set('theme', 'light');
		expect(a.get('config').get('theme')).toBe('light');
		expect(b.get('config').get('theme')).toBe('light');
	});
});
