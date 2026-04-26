import { describe, it, expect } from 'vitest';
import { draftSet, draftMap } from '../core/draft.js';

describe('draftSet', () => {
	it('returns the same Set when nothing changes', () => {
		const source = new Set([1, 2, 3]);
		const result = draftSet(source, () => {});
		expect(result).toBe(source);
	});

	it('adds new values', () => {
		const source = new Set([1, 2]);
		const result = draftSet(source, (draft) => {
			draft.add(3);
		});
		expect(result).toEqual(new Set([1, 2, 3]));
		expect(result).not.toBe(source);
	});

	it('deletes existing values', () => {
		const source = new Set([1, 2, 3]);
		const result = draftSet(source, (draft) => {
			draft.delete(2);
		});
		expect(result).toEqual(new Set([1, 3]));
	});

	it('delete returns false for non-existent values', () => {
		const source = new Set([1, 2]);
		let deleteResult = false;
		draftSet(source, (draft) => {
			deleteResult = draft.delete(99);
		});
		expect(deleteResult).toBe(false);
	});

	it('delete returns true and removes an added (non-source) value', () => {
		const source = new Set([1]);
		let deleteResult = false;
		const result = draftSet(source, (draft) => {
			draft.add(2);
			deleteResult = draft.delete(2);
		});
		expect(deleteResult).toBe(true);
		// Added then removed, so no net change
		expect(result).toBe(source);
	});

	it('tracks size correctly', () => {
		const source = new Set([1, 2, 3]);
		draftSet(source, (draft) => {
			expect(draft.size).toBe(3);
			draft.add(4);
			expect(draft.size).toBe(4);
			draft.delete(1);
			expect(draft.size).toBe(3);
		});
	});

	it('has() reflects adds and deletes', () => {
		const source = new Set([1, 2]);
		draftSet(source, (draft) => {
			expect(draft.has(1)).toBe(true);
			expect(draft.has(3)).toBe(false);
			draft.add(3);
			expect(draft.has(3)).toBe(true);
			draft.delete(1);
			expect(draft.has(1)).toBe(false);
		});
	});

	it('clear removes all source values', () => {
		const source = new Set([1, 2, 3]);
		const result = draftSet(source, (draft) => {
			draft.clear();
			expect(draft.size).toBe(0);
		});
		expect(result).toEqual(new Set());
	});

	it('forEach iterates over draft values', () => {
		const source = new Set([1, 2, 3]);
		draftSet(source, (draft) => {
			draft.delete(2);
			draft.add(4);
			const values: number[] = [];
			draft.forEach((value) => values.push(value));
			expect(values).toEqual([1, 3, 4]);
		});
	});

	it('keys/values/entries iterate correctly', () => {
		const source = new Set([1, 2]);
		draftSet(source, (draft) => {
			draft.add(3);
			expect([...draft.keys()]).toEqual([1, 2, 3]);
			expect([...draft.values()]).toEqual([1, 2, 3]);
			expect([...draft.entries()]).toEqual([
				[1, 1],
				[2, 2],
				[3, 3],
			]);
		});
	});

	it('re-adding a deleted source value restores it', () => {
		const source = new Set([1, 2]);
		const result = draftSet(source, (draft) => {
			draft.delete(1);
			draft.add(1);
		});
		// No net change
		expect(result).toBe(source);
	});
});

describe('draftMap', () => {
	it('returns the same Map when nothing changes', () => {
		const source = new Map([
			['a', 1],
			['b', 2],
		]);
		const result = draftMap(source, () => {});
		expect(result).toBe(source);
	});

	it('adds new entries', () => {
		const source = new Map([['a', 1]]);
		const result = draftMap(source, (draft) => {
			draft.set('b', 2);
		});
		expect(result).toEqual(
			new Map([
				['a', 1],
				['b', 2],
			]),
		);
		expect(result).not.toBe(source);
	});

	it('updates existing entries', () => {
		const source = new Map([['a', 1]]);
		const result = draftMap(source, (draft) => {
			draft.set('a', 10);
		});
		expect(result.get('a')).toBe(10);
	});

	it('deletes existing entries', () => {
		const source = new Map([
			['a', 1],
			['b', 2],
		]);
		const result = draftMap(source, (draft) => {
			draft.delete('a');
		});
		expect(result).toEqual(new Map([['b', 2]]));
	});

	it('delete returns false for non-existent keys', () => {
		const source = new Map([['a', 1]]);
		let deleteResult = false;
		draftMap(source, (draft) => {
			deleteResult = draft.delete('z');
		});
		expect(deleteResult).toBe(false);
	});

	it('delete returns true for pending put keys', () => {
		const source = new Map([['x', 99]]);
		let deleteResult = false;
		draftMap(source, (draft) => {
			draft.set('a', 1);
			deleteResult = draft.delete('a');
		});
		expect(deleteResult).toBe(true);
	});

	it('tracks size correctly', () => {
		const source = new Map([
			['a', 1],
			['b', 2],
		]);
		draftMap(source, (draft) => {
			expect(draft.size).toBe(2);
			draft.set('c', 3);
			expect(draft.size).toBe(3);
			draft.delete('a');
			expect(draft.size).toBe(2);
		});
	});

	it('has() reflects puts and deletes', () => {
		const source = new Map([['a', 1]]);
		draftMap(source, (draft) => {
			expect(draft.has('a')).toBe(true);
			expect(draft.has('b')).toBe(false);
			draft.set('b', 2);
			expect(draft.has('b')).toBe(true);
			draft.delete('a');
			expect(draft.has('a')).toBe(false);
		});
	});

	it('get() returns correct values through mutations', () => {
		const source = new Map([['a', 1]]);
		draftMap(source, (draft) => {
			expect(draft.get('a')).toBe(1);
			draft.set('a', 10);
			expect(draft.get('a')).toBe(10);
			draft.delete('a');
			expect(draft.get('a')).toBeUndefined();
			expect(draft.get('z')).toBeUndefined();
		});
	});

	it('clear removes all entries', () => {
		const source = new Map([
			['a', 1],
			['b', 2],
		]);
		const result = draftMap(source, (draft) => {
			draft.clear();
			expect(draft.size).toBe(0);
		});
		expect(result).toEqual(new Map());
	});

	it('forEach iterates over draft entries', () => {
		const source = new Map([
			['a', 1],
			['b', 2],
		]);
		draftMap(source, (draft) => {
			draft.delete('a');
			draft.set('c', 3);
			const entries: [string, number][] = [];
			draft.forEach((value, key) => entries.push([key, value]));
			expect(entries).toEqual([
				['b', 2],
				['c', 3],
			]);
		});
	});

	it('keys/values iterate correctly', () => {
		const source = new Map([['a', 1]]);
		draftMap(source, (draft) => {
			draft.set('b', 2);
			expect([...draft.keys()]).toEqual(['a', 'b']);
			expect([...draft.values()]).toEqual([1, 2]);
		});
	});

	it('entries/iterator iterate correctly', () => {
		const source = new Map([['a', 1]]);
		draftMap(source, (draft) => {
			draft.set('b', 2);
			expect([...draft.entries()]).toEqual([
				['a', 1],
				['b', 2],
			]);
			expect([...draft]).toEqual([
				['a', 1],
				['b', 2],
			]);
		});
	});
});
