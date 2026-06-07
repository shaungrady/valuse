import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';

describe('$setSnapshot robustness', () => {
	it('ignores non-object input (null, undefined, primitives) without throwing', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const scope = valueScope({ name: value<string>('init') });
			const inst = scope.create({ name: 'a' });
			for (const bad of [null, undefined, 42, 'str', true]) {
				expect(() =>
					(inst.$setSnapshot as (d: unknown) => void)(bad),
				).not.toThrow();
			}
			// State is left untouched by garbage input.
			expect(inst.name.get()).toBe('a');
			// And the caller gets a diagnostic rather than silent corruption.
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it('ignores unknown fields and applies known ones', () => {
		const scope = valueScope({ name: value<string>('init') });
		const inst = scope.create({ name: 'a' });
		(inst.$setSnapshot as (d: Record<string, unknown>) => void)({
			unknown: 1,
			name: 'b',
		});
		expect(inst.name.get()).toBe('b');
	});

	it('$getSnapshot returns an isolated object — external mutation does not leak', () => {
		const scope = valueScope({ name: value<string>('x') });
		const inst = scope.create({ name: 'x' });
		const snap = inst.$getSnapshot() as Record<string, unknown>;
		snap.name = 'MUTATED';
		expect(inst.name.get()).toBe('x');
	});
});
