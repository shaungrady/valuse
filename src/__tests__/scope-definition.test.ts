import { describe, it, expect } from 'vitest';
import { buildScopeDefinition } from '../core/scope-definition.js';
import { value } from '../core/value.js';

describe('buildScopeDefinition', () => {
	describe('slot assignment', () => {
		it('assigns sequential slots to value() entries', () => {
			const definition = buildScopeDefinition({
				firstName: value<string>(),
				lastName: value<string>(),
			});
			expect(definition.slotCount).toBe(2);
			expect(definition.slots[0]!.path).toBe('firstName');
			expect(definition.slots[1]!.path).toBe('lastName');
		});

		it('assigns slots to nested value() entries', () => {
			const definition = buildScopeDefinition({
				firstName: value<string>(),
				job: {
					title: value<string>(),
					company: value<string>(),
				},
			});
			expect(definition.slotCount).toBe(3);
			expect(definition.slots[0]!.path).toBe('firstName');
			expect(definition.slots[1]!.path).toBe('job.title');
			expect(definition.slots[2]!.path).toBe('job.company');
		});

		it('skips static data (no slot assignment)', () => {
			const definition = buildScopeDefinition({
				firstName: value<string>(),
				schemaVersion: 1,
			});
			expect(definition.slotCount).toBe(1);
			expect(definition.staticEntries.get('schemaVersion')).toBe(1);
		});
	});

	describe('slot kinds', () => {
		it('marks value() entries as "value"', () => {
			const definition = buildScopeDefinition({
				name: value<string>(),
			});
			expect(definition.slots[0]!.kind).toBe('value');
		});

		it('marks sync functions as "derived"', () => {
			const definition = buildScopeDefinition({
				firstName: value<string>(),
				greeting: ({ scope: _scope }: { scope: unknown }) => `Hello`,
			});
			expect(definition.slots[1]!.kind).toBe('derived');
			expect(definition.slots[1]!.derivationFn).toBeTypeOf('function');
		});

		it('marks async functions as "asyncDerived"', () => {
			const definition = buildScopeDefinition({
				userId: value<string>(),
				profile: async ({ scope: _scope }: { scope: unknown }) => ({}),
			});
			expect(definition.slots[1]!.kind).toBe('asyncDerived');
		});
	});

	describe('default values', () => {
		it('captures default from value(initial)', () => {
			const definition = buildScopeDefinition({
				name: value<string>('Alice'),
			});
			expect(definition.slots[0]!.defaultValue).toBe('Alice');
		});

		it('captures undefined for value() without default', () => {
			const definition = buildScopeDefinition({
				name: value<string>(),
			});
			expect(definition.slots[0]!.defaultValue).toBeUndefined();
		});

		it('captures piped default value', () => {
			const definition = buildScopeDefinition({
				name: value<string>('  HELLO  ').pipe((s) => s.trim()),
			});
			expect(definition.slots[0]!.defaultValue).toBe('HELLO');
		});
	});

	describe('pipeline metadata', () => {
		it('stores null for entries without pipes', () => {
			const definition = buildScopeDefinition({
				name: value<string>(),
			});
			expect(definition.slots[0]!.pipeline).toBeNull();
		});

		it('stores pipe steps for entries with pipes', () => {
			const definition = buildScopeDefinition({
				name: value<string>('').pipe((s) => s.trim()),
			});
			expect(definition.slots[0]!.pipeline).toHaveLength(1);
			expect(definition.slots[0]!.pipeline![0]!.kind).toBe('sync');
		});
	});

	describe('comparator metadata', () => {
		it('stores null without compareUsing', () => {
			const definition = buildScopeDefinition({
				name: value<string>(),
			});
			expect(definition.slots[0]!.comparator).toBeNull();
		});

		it('stores comparator from compareUsing', () => {
			const comparator = (a: string, b: string) => a === b;
			const definition = buildScopeDefinition({
				name: value<string>('').compareUsing(comparator),
			});
			expect(definition.slots[0]!.comparator).toBe(comparator);
		});
	});

	describe('groups', () => {
		it('creates a root group at index 0', () => {
			const definition = buildScopeDefinition({
				name: value<string>(),
			});
			expect(definition.groups[0]!.path).toBe('');
			expect(definition.groups[0]!.index).toBe(0);
		});

		it('creates a group for nested plain objects', () => {
			const definition = buildScopeDefinition({
				job: {
					title: value<string>(),
				},
			});
			expect(definition.groups).toHaveLength(2); // root + job
			expect(definition.groups[1]!.path).toBe('job');
			expect(definition.groups[1]!.childSlots).toEqual([0]);
		});

		it('tracks ancestor group indices for slots (excludes root)', () => {
			const definition = buildScopeDefinition({
				a: {
					b: {
						name: value<string>(),
					},
				},
			});
			// Groups: root (0) -> a (1) -> b (2)
			expect(definition.groups[1]!.ancestorGroupIndices).toEqual([0]);
			expect(definition.groups[2]!.ancestorGroupIndices).toEqual([0, 1]);

			// Slot ancestors exclude root (0) since InstanceStore handles root bubbling separately.
			// "a.b.name" should have ancestors [1, 2] (group a, group b).
			const nameSlot = definition.slots[0]!;
			expect(nameSlot.ancestorGroupIndices).toEqual([1, 2]);
		});

		it('gives top-level slots empty ancestor indices', () => {
			const definition = buildScopeDefinition({
				name: value<string>(),
			});
			expect(definition.slots[0]!.ancestorGroupIndices).toEqual([]);
		});

		it('gives one-level-deep slots only their parent group', () => {
			const definition = buildScopeDefinition({
				job: {
					title: value<string>(),
				},
			});
			// "job.title" is inside group "job" (1), root handled separately
			expect(definition.slots[0]!.ancestorGroupIndices).toEqual([1]);
		});
	});

	describe('static entries', () => {
		it('captures plain values as static entries', () => {
			const definition = buildScopeDefinition({
				schemaVersion: 1,
				label: 'test',
			});
			expect(definition.staticEntries.get('schemaVersion')).toBe(1);
			expect(definition.staticEntries.get('label')).toBe('test');
		});

		it('freezes array static entries', () => {
			const definition = buildScopeDefinition({
				tags: ['a', 'b'],
			});
			const tags = definition.staticEntries.get('tags');
			expect(Object.isFrozen(tags)).toBe(true);
		});
	});

	describe('deeply nested', () => {
		it('handles multiple nesting levels', () => {
			const definition = buildScopeDefinition({
				user: {
					name: value<string>(),
					settings: {
						theme: value<string>('light'),
						notifications: value<boolean>(true),
					},
				},
			});
			expect(definition.slotCount).toBe(3);
			expect(definition.slots[0]!.path).toBe('user.name');
			expect(definition.slots[1]!.path).toBe('user.settings.theme');
			expect(definition.slots[2]!.path).toBe('user.settings.notifications');
			expect(definition.slots[1]!.defaultValue).toBe('light');
			expect(definition.slots[2]!.defaultValue).toBe(true);

			// Groups: root(0), user(1), settings(2)
			expect(definition.groups).toHaveLength(3);
		});
	});
});
