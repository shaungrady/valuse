import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';

describe('extendValues + extendConfig', () => {
	it('adds new fields to the scope', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const employee = person.extendValues({
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
		const extended = base.extendValues({
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
		const stripped = base.extendValues({ age: undefined });
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
		const extended = base
			.extendValues({ role: value<string>() })
			.extendConfig({ onCreate: extCreate });

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
		const extended = base.extendConfig({
			onDestroy: () => order.push('ext'),
		});
		const instance = extended.create({ name: 'Bob' });
		instance.$destroy();
		expect(order).toEqual(['base', 'ext']);
	});

	it('adds derivations referencing base fields', () => {
		const base = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const extended = base.extendValues({
			fullName: ({ scope }) =>
				`${scope.firstName.use()} ${scope.lastName.use()}`,
		});
		const bob = extended.create({
			firstName: 'Bob',
			lastName: 'Jones',
		});
		expect(bob.fullName.get()).toBe('Bob Jones');
	});

	/**
	 * Edge: removing a field that an *inherited* derivation references.
	 * Static types would catch this in most cases, but at runtime the
	 * inherited derivation reaches into `scope.<removed>.use()` and finds
	 * `undefined`, which throws. With throw containment (TODO #1) the
	 * library no longer crashes the `.set()` that triggered the recompute;
	 * instead, the derivation logs `console.error` once per failing run
	 * and the slot keeps its last-good value (undefined on first run).
	 *
	 * Pinning this contract so future refactors don't quietly downgrade
	 * to either (a) a hard crash on create, or (b) silent NaN-style
	 * behavior with no diagnostic.
	 */
	describe('removing a field referenced by an inherited derivation', () => {
		it('create() does not throw', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const base = valueScope(
				{ name: value<string>('Bob') },
				{ greeting: ({ scope }) => `Hello ${scope.name.use()}` },
			);
			const stripped = base.extendValues({ name: undefined });
			expect(() => stripped.create()).not.toThrow();
			errSpy.mockRestore();
		});

		it('logs an error from the derivation on each failing run', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const base = valueScope(
				{ name: value<string>('Bob') },
				{ greeting: ({ scope }) => `Hello ${scope.name.use()}` },
			);
			const stripped = base.extendValues({ name: undefined });
			stripped.create();
			expect(errSpy).toHaveBeenCalled();
			errSpy.mockRestore();
		});
	});

	/**
	 * Edge: an extension swaps a `value()` slot for a derivation. Types
	 * narrow `name` to a `Derived<…>` wrapper on the extended scope, so
	 * `.set()` is a compile error — but only if the caller isn't using
	 * `any`. At runtime, `instance.name.set` is undefined and accessing
	 * it throws a `TypeError`.
	 *
	 * We don't prevent this: kind swaps in extensions are a legitimate
	 * refactor pattern, and types do most of the work. Pinning the
	 * current behavior so a future "fail loudly at create()" change is a
	 * deliberate decision, not a silent regression.
	 */
	it('kind swap from value() to derivation is allowed; no .set() at runtime', () => {
		const base = valueScope({
			name: value<string>('Bob'),
		});
		const swapped = base.extendValues({
			name: () => 'Robert',
		});
		const instance = swapped.create();
		expect(instance.name.get()).toBe('Robert');
		// The wrapper no longer has a .set method.
		expect((instance.name as any).set).toBeUndefined();
	});

	/**
	 * Pinning: across a chain of extends, the merged `validate` runs in
	 * declaration order — base first, then each extension in the order
	 * they were applied. `getValidation()` on each schema field, and
	 * `$getValidation()` on the scope, both expose issues in the same
	 * order.
	 */
	it('validate hooks run in base → extension order across a chain', () => {
		const order: string[] = [];
		const base = valueScope(
			{ name: value<string>('Bob') },
			{
				validate: () => {
					order.push('base');
					return [{ message: 'base' }];
				},
			},
		);
		const a = base.extendConfig({
			validate: () => {
				order.push('a');
				return [{ message: 'a' }];
			},
		});
		const b = a.extendConfig({
			validate: () => {
				order.push('b');
				return [{ message: 'b' }];
			},
		});
		const c = b.extendConfig({
			validate: () => {
				order.push('c');
				return [{ message: 'c' }];
			},
		});
		const instance = c.create();
		const validation = instance.$getValidation();
		expect(order).toEqual(['base', 'a', 'b', 'c']);
		expect(
			validation.issues.map((i: { message: string }) => i.message),
		).toEqual(['base', 'a', 'b', 'c']);
	});
});
