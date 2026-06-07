import { describe, it, expect } from 'vitest';
import { setNestedValue } from '../core/scope-snapshot.js';

/**
 * Unit coverage for `setNestedValue`, the shared path-writer used by every
 * snapshot build and instance-tree population. Previously only exercised
 * indirectly through `valueScope(...)`; tested directly here so its contract
 * (and the dot-less fast path) is pinned.
 */
describe('setNestedValue', () => {
	it.each<{
		name: string;
		target: Record<string, unknown>;
		path: string;
		value: unknown;
		expected: Record<string, unknown>;
	}>([
		{
			name: 'top-level key (dot-less fast path)',
			target: {},
			path: 'name',
			value: 'Alice',
			expected: { name: 'Alice' },
		},
		{
			name: 'overwrites an existing top-level key',
			target: { name: 'Alice' },
			path: 'name',
			value: 'Bob',
			expected: { name: 'Bob' },
		},
		{
			name: 'creates a missing intermediate object',
			target: {},
			path: 'job.title',
			value: 'Dev',
			expected: { job: { title: 'Dev' } },
		},
		{
			name: 'reuses an existing intermediate object',
			target: { job: { salary: 100 } },
			path: 'job.title',
			value: 'Dev',
			expected: { job: { salary: 100, title: 'Dev' } },
		},
		{
			name: 'builds a deeply nested path',
			target: {},
			path: 'a.b.c.d',
			value: 1,
			expected: { a: { b: { c: { d: 1 } } } },
		},
		{
			name: 'replaces a non-object intermediate with a fresh object',
			target: { a: 5 },
			path: 'a.b',
			value: 2,
			expected: { a: { b: 2 } },
		},
		{
			name: 'preserves sibling keys while nesting',
			target: { keep: true },
			path: 'group.child',
			value: 'x',
			expected: { keep: true, group: { child: 'x' } },
		},
	])('$name', ({ target, path, value, expected }) => {
		setNestedValue(target, path, value);
		expect(target).toEqual(expected);
	});

	it('writes undefined as a real value (does not skip)', () => {
		const target: Record<string, unknown> = { a: 1 };
		setNestedValue(target, 'a', undefined);
		expect('a' in target).toBe(true);
		expect(target.a).toBeUndefined();
	});

	it('does not allocate a split array for the dot-less path (smoke)', () => {
		// Behavioral proxy for the fast path: a key that *contains* no dot is
		// written verbatim, never treated as a nested path.
		const target: Record<string, unknown> = {};
		setNestedValue(target, 'no-dots-here', 1);
		expect(target).toEqual({ 'no-dots-here': 1 });
	});
});
