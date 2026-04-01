import { describe, it, expect } from 'vitest';
import { value, valueScope } from '../index.js';

describe('allowUndeclaredProperties', () => {
	const baseNode = valueScope(
		{
			id: value<string>(),
			type: value<string>(),
			isHighlighted: value<boolean>(false),
		},
		{ allowUndeclaredProperties: true },
	);

	it('preserves undeclared properties from create()', () => {
		const inst = baseNode.create({
			id: 'node-1',
			type: 'paragraph',
			text: 'hello world',
			bold: true,
		} as any);

		expect(inst.get('id')).toBe('node-1');
		expect(inst.get('text' as any)).toBe('hello world');
		expect(inst.get('bold' as any)).toBe(true);
	});

	it('undeclared properties are accessible via get()', () => {
		const inst = baseNode.create({
			id: 'n1',
			type: 'p',
			children: [1, 2, 3],
		} as any);

		expect(inst.get('children' as any)).toEqual([1, 2, 3]);
	});

	it('declared values remain reactive', () => {
		const inst = baseNode.create({
			id: 'n1',
			type: 'p',
			extra: 'data',
		} as any);

		inst.set('isHighlighted', true);
		expect(inst.get('isHighlighted')).toBe(true);
	});

	it('bulk set() stores new undeclared properties', () => {
		const inst = baseNode.create({ id: 'n1', type: 'p' } as any);
		(inst as any).set({ text: 'hello', bold: true });
		expect(inst.get('text' as any)).toBe('hello');
		expect(inst.get('bold' as any)).toBe(true);
	});

	it('bulk set() updates existing undeclared properties', () => {
		const inst = baseNode.create({
			id: 'n1',
			type: 'p',
			text: 'original',
		} as any);

		(inst as any).set({ text: 'updated' });
		expect(inst.get('text' as any)).toBe('updated');
	});

	it('bulk set() handles mix of declared and undeclared', () => {
		const inst = baseNode.create({ id: 'n1', type: 'p' } as any);
		(inst as any).set({ isHighlighted: true, text: 'hello' });
		expect(inst.get('isHighlighted')).toBe(true);
		expect(inst.get('text' as any)).toBe('hello');
	});

	it('derivations can read undeclared properties', () => {
		const scope = valueScope(
			{
				name: value<string>(),
				label: ({ use }) => `${use('name')} (${use('extra')})`,
			},
			{ allowUndeclaredProperties: true },
		);
		const inst = scope.create({ name: 'Alice', extra: 'admin' } as any);
		expect(inst.get('label')).toBe('Alice (admin)');
	});

	it('without flag, undeclared properties are silently dropped', () => {
		const scope = valueScope({
			x: value(0),
		});
		const inst = scope.create({ x: 1, extra: 'ignored' } as any);
		expect(inst.get('extra' as any)).toBeUndefined();
	});

	it('works with extend() — flag propagates', () => {
		const extended = baseNode.extend({
			text: value<string>(''),
		});
		const inst = extended.create({
			id: 'n1',
			type: 'p',
			text: 'hello',
			bold: true,
		} as any);

		// text is now a declared value (promoted by extend)
		expect(inst.get('text')).toBe('hello');
		// bold is still undeclared passthrough
		expect(inst.get('bold' as any)).toBe(true);
	});

	it('works with .createMap()', () => {
		const coll = baseNode.createMap();
		coll.set('n1', { id: 'n1', type: 'p', text: 'hello' } as any);
		expect(coll.get('n1')!.get('text' as any)).toBe('hello');
	});

	it('get() returns undefined for non-existent undeclared keys', () => {
		const inst = baseNode.create({ id: 'n1', type: 'p' } as any);
		expect(inst.get('nonexistent' as any)).toBeUndefined();
	});
});
