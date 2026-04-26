import { describe, it, expect, vi } from 'vitest';
import { valueSet } from '../core/value-set.js';
import { valueMap } from '../core/value-map.js';
import { valuePlain } from '../core/value-plain.js';
import { draftSet, draftMap } from '../core/draft.js';

describe('draftSet', () => {
	it('returns original when nothing changes', () => {
		const source = new Set([1, 2, 3]);
		const result = draftSet(source, () => {});
		expect(result).toBe(source);
	});

	it('adds elements via draft', () => {
		const source = new Set([1, 2]);
		const result = draftSet(source, (d) => d.add(3));
		expect(result).toEqual(new Set([1, 2, 3]));
		expect(result).not.toBe(source);
	});

	it('deletes elements via draft', () => {
		const source = new Set([1, 2, 3]);
		const result = draftSet(source, (d) => d.delete(2));
		expect(result).toEqual(new Set([1, 3]));
	});

	it('iteration reflects pending mutations', () => {
		const source = new Set([1, 2, 3]);
		const observed: number[][] = [];
		draftSet(source, (d) => {
			d.add(4);
			d.delete(2);
			observed.push([...d]);
			observed.push([...d.values()]);
			observed.push([...d.keys()]);
			observed.push([...d.entries()].map(([v]) => v));
			const byForEach: number[] = [];
			d.forEach((value) => byForEach.push(value));
			observed.push(byForEach);
		});
		for (const snapshot of observed) {
			expect(new Set(snapshot)).toEqual(new Set([1, 3, 4]));
		}
	});

	it('clear + add re-adds deleted values', () => {
		const source = new Set([1, 2]);
		const result = draftSet(source, (d) => {
			d.clear();
			d.add(2);
			d.add(3);
		});
		expect(result).toEqual(new Set([2, 3]));
	});

	it('delete of pending add is a no-op on source', () => {
		const source = new Set([1]);
		const result = draftSet(source, (d) => {
			d.add(2);
			expect(d.delete(2)).toBe(true);
		});
		expect(result).toBe(source);
	});

	it('handles large batches efficiently', () => {
		const source = new Set<number>();
		const result = draftSet(source, (d) => {
			for (let i = 0; i < 10_000; i++) d.add(i);
		});
		expect(result.size).toBe(10_000);
	});
});

describe('draftMap', () => {
	it('returns original when nothing changes', () => {
		const source = new Map([['a', 1]]);
		const result = draftMap(source, () => {});
		expect(result).toBe(source);
	});

	it('sets entries via draft', () => {
		const source = new Map([['a', 1]]);
		const result = draftMap(source, (d) => d.set('b', 2));
		expect(result.get('b')).toBe(2);
		expect(result).not.toBe(source);
	});

	it('deletes entries via draft', () => {
		const source = new Map([
			['a', 1],
			['b', 2],
		]);
		const result = draftMap(source, (d) => d.delete('a'));
		expect(result.has('a')).toBe(false);
		expect(result.get('b')).toBe(2);
	});

	it('iteration reflects pending mutations', () => {
		const source = new Map<string, number>([
			['a', 1],
			['b', 2],
		]);
		const snapshots: [string, number][][] = [];
		draftMap(source, (d) => {
			d.set('c', 3);
			d.set('a', 10); // override existing
			d.delete('b');
			snapshots.push([...d]);
			snapshots.push([...d.entries()]);
			const keys = [...d.keys()];
			const values = [...d.values()];
			snapshots.push(keys.map((k, i) => [k, values[i]!]));
		});
		for (const snapshot of snapshots) {
			expect(new Map(snapshot)).toEqual(
				new Map([
					['a', 10],
					['c', 3],
				]),
			);
		}
	});
});

describe('ValueSet', () => {
	it('creates from array', () => {
		const s = valueSet([1, 2, 3]);
		expect(s.get()).toEqual(new Set([1, 2, 3]));
	});

	it('add/delete/has/size/clear', () => {
		const s = valueSet<string>();
		s.add('a');
		expect(s.has('a')).toBe(true);
		expect(s.size).toBe(1);
		s.delete('a');
		expect(s.has('a')).toBe(false);
		s.add('b');
		s.add('c');
		s.clear();
		expect(s.size).toBe(0);
	});

	it('set via draft callback', () => {
		const s = valueSet([1, 2]);
		s.set((d) => {
			d.add(3);
			d.delete(1);
		});
		expect(s.get()).toEqual(new Set([2, 3]));
	});

	it('subscribe fires with (value, prev)', () => {
		const s = valueSet([1]);
		const subscriber = vi.fn();
		s.subscribe(subscriber);
		s.add(2);
		expect(subscriber).toHaveBeenCalledOnce();
		const [newSet, prevSet] = subscriber.mock.calls[0]!;
		expect(newSet).toEqual(new Set([1, 2]));
		expect(prevSet).toEqual(new Set([1]));
	});

	it('pipe transforms on set', () => {
		const s = valueSet<string>().pipe(
			(set) => new Set([...set].map((v) => v.toLowerCase())),
		);
		s.set(new Set(['HELLO', 'WORLD']));
		expect(s.values()).toEqual(['hello', 'world']);
	});

	it('compareUsing skips identical updates', () => {
		const subscriber = vi.fn();
		const s = valueSet([1, 2]).compareUsing((a, b) => a.size === b.size);
		s.subscribe(subscriber);
		s.set(new Set([3, 4])); // same size
		expect(subscriber).not.toHaveBeenCalled();
	});

	it('destroy stops subscriptions', () => {
		const s = valueSet<number>();
		const subscriber = vi.fn();
		s.subscribe(subscriber);
		s.destroy();
		s.add(1);
		expect(subscriber).not.toHaveBeenCalled();
	});
});

describe('ValueMap', () => {
	it('creates from entries', () => {
		const m = valueMap<string, number>([['a', 1]]);
		expect(m.get('a')).toBe(1);
		expect(m.size).toBe(1);
	});

	it('set/get/delete/has/keys/values/entries/clear', () => {
		const m = valueMap<string, number>();
		m.set(new Map([['a', 1]]));
		expect(m.has('a')).toBe(true);
		expect(m.get('a')).toBe(1);
		expect(m.keys()).toEqual(['a']);
		expect(m.values()).toEqual([1]);
		expect(m.entries()).toEqual([['a', 1]]);
		m.delete('a');
		expect(m.has('a')).toBe(false);
		m.set(
			new Map([
				['x', 1],
				['y', 2],
			]),
		);
		m.clear();
		expect(m.size).toBe(0);
	});

	it('set via draft callback', () => {
		const m = valueMap<string, number>([['a', 1]]);
		m.set((d) => {
			d.set('b', 2);
			d.delete('a');
		});
		expect(m.has('a')).toBe(false);
		expect(m.get('b')).toBe(2);
	});

	it('subscribe fires with (value, prev)', () => {
		const m = valueMap<string, number>([['a', 1]]);
		const subscriber = vi.fn();
		m.subscribe(subscriber);
		m.set((d) => d.set('b', 2));
		expect(subscriber).toHaveBeenCalledOnce();
		const [newMap, prevMap] = subscriber.mock.calls[0]!;
		expect(newMap.get('b')).toBe(2);
		expect(prevMap.has('b')).toBe(false);
	});

	it('destroy stops subscriptions', () => {
		const m = valueMap<string, number>();
		const subscriber = vi.fn();
		m.subscribe(subscriber);
		m.destroy();
		m.set(new Map([['a', 1]]));
		expect(subscriber).not.toHaveBeenCalled();
	});
});

describe('ValuePlain', () => {
	it('stores a value', () => {
		const p = valuePlain(42);
		expect(p._value).toBe(42);
		expect(p._readonly).toBe(false);
	});

	it('readonly flag', () => {
		const p = valuePlain('hello', { readonly: true });
		expect(p._readonly).toBe(true);
	});
});
