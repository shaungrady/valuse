import { describe, it, expect, vi } from 'vitest';
import { value, valueScope } from '../index.js';

const person = valueScope({
	firstName: value<string>(),
	lastName: value<string>(),
	fullName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
});

describe('.extend()', () => {
	it('creates a new scope with additional values', () => {
		const tracked = person.extend({
			lastUpdated: value<number>(0),
		});
		const inst = tracked.create({ firstName: 'Bob', lastName: 'Jones' });
		expect(inst.get('firstName')).toBe('Bob');
		expect(inst.get('lastUpdated')).toBe(0);
	});

	it('creates a new scope with additional derivations', () => {
		const extended = person.extend({
			greeting: ({ use }) => `Hello, ${use('fullName')}!`,
		});
		const inst = extended.create({ firstName: 'Bob', lastName: 'Jones' });
		expect(inst.get('greeting')).toBe('Hello, Bob Jones!');
	});

	it('extended derivations can reference original values', () => {
		const extended = person.extend({
			initials: ({ use }) => {
				const f = (use('firstName') as string)?.[0] ?? '';
				const l = (use('lastName') as string)?.[0] ?? '';
				return `${f}${l}`;
			},
		});
		const inst = extended.create({ firstName: 'Bob', lastName: 'Jones' });
		expect(inst.get('initials')).toBe('BJ');
	});

	it('does not modify the original scope', () => {
		const tracked = person.extend({
			lastUpdated: value<number>(0),
		});
		const original = person.create({ firstName: 'Alice' });
		const extended = tracked.create({ firstName: 'Bob' });

		expect(original.get('firstName')).toBe('Alice');
		expect(extended.get('firstName')).toBe('Bob');
		expect(extended.get('lastUpdated')).toBe(0);
		// original should not have lastUpdated
		expect((original as any).get('lastUpdated')).toBeUndefined();
	});

	it('accepts lifecycle hooks in extend', async () => {
		const onChange = vi.fn();
		const tracked = person.extend(
			{
				changeCount: value<number>(0),
			},
			{
				onChange: ({ set }) => {
					onChange();
					set('changeCount', (prev: number) => prev + 1);
				},
			},
		);
		const inst = tracked.create({ firstName: 'Bob', lastName: 'Jones' });
		inst.set('firstName', 'Robert');
		await Promise.resolve();
		expect(onChange).toHaveBeenCalledOnce();
		expect(inst.get('changeCount')).toBe(1);
	});

	it('preserves original lifecycle hooks', () => {
		const onInit = vi.fn();
		const base = valueScope({ x: value<number>(0) }, { onInit });
		const extended = base.extend({ y: value<number>(0) });
		extended.create();
		expect(onInit).toHaveBeenCalledOnce();
	});
});
