import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';

describe('extend', () => {
	it('adds new fields to the scope', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const employee = person.extend({
			department: value<string>(),
		});
		const bob = employee.create({
			firstName: 'Bob',
			lastName: 'Jones',
			department: 'Engineering',
		});
		expect(bob.firstName.get()).toBe('Bob');
		expect(bob.department.get()).toBe('Engineering');
	});

	it('overrides fields from the base', () => {
		const base = valueScope({
			name: value<string>('default'),
		});
		const extended = base.extend({
			name: value<string>('overridden'),
		});
		const instance = extended.create();
		expect(instance.name.get()).toBe('overridden');
	});

	it('removes fields with undefined', () => {
		const base = valueScope({
			name: value<string>(),
			age: value<number>(),
		});
		const stripped = base.extend({ age: undefined });
		const instance = stripped.create({ name: 'Bob' });
		expect(instance.name.get()).toBe('Bob');
		expect((instance as any).age).toBeUndefined();
	});

	it('merges lifecycle hooks (both fire)', () => {
		const baseCreate = vi.fn();
		const extCreate = vi.fn();

		const base = valueScope(
			{ name: value<string>() },
			{ onCreate: baseCreate },
		);
		const extended = base.extend(
			{ role: value<string>() },
			{ onCreate: extCreate },
		);

		extended.create({ name: 'Bob', role: 'admin' });
		expect(baseCreate).toHaveBeenCalledOnce();
		expect(extCreate).toHaveBeenCalledOnce();
	});

	it('merges onDestroy hooks', () => {
		const order: string[] = [];
		const base = valueScope(
			{ name: value<string>() },
			{ onDestroy: () => order.push('base') },
		);
		const extended = base.extend({}, { onDestroy: () => order.push('ext') });
		const instance = extended.create({ name: 'Bob' });
		instance.$destroy();
		expect(order).toEqual(['base', 'ext']);
	});

	it('adds derivations referencing base fields', () => {
		const base = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const extended = base.extend({
			fullName: ({ scope }: { scope: any }) =>
				`${scope.firstName.use()} ${scope.lastName.use()}`,
		});
		const bob = extended.create({
			firstName: 'Bob',
			lastName: 'Jones',
		});
		expect(bob.fullName.get()).toBe('Bob Jones');
	});
});
