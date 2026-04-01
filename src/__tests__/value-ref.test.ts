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
