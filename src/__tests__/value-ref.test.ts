import { describe, it, expect } from 'vitest';
import { value } from '../core/value.js';
import { valueRef, ValueRef } from '../core/value-ref.js';
import { valueSet } from '../core/value-set.js';
import { valueMap } from '../core/value-map.js';

describe('valueRef', () => {
	it('creates a ref to a Value', () => {
		const name = value('Alice');
		const ref = valueRef(name);
		expect(ref).toBeInstanceOf(ValueRef);
		expect(ref.get()).toBe('Alice');
		name.set('Bob');
		expect(ref.get()).toBe('Bob');
	});

	it('creates a ref to a ValueSet', () => {
		const tags = valueSet(['a', 'b']);
		const ref = valueRef(tags);
		expect(ref.get()).toBeInstanceOf(Set);
		expect(ref.get().has('a')).toBe(true);
	});

	it('creates a ref to a ValueMap', () => {
		const scores = valueMap<string, number>([['alice', 95]]);
		const ref = valueRef(scores);
		expect(ref.get()).toBeInstanceOf(Map);
		expect(ref.get().get('alice')).toBe(95);
	});

	it('creates a ref from a factory function', () => {
		const ref = valueRef(() => value('factory'));
		expect(ref.factory).toBeDefined();
		// Factory refs are resolved per-instance; the initial getter returns undefined
		expect(ref.get()).toBeUndefined();
	});

	it('creates a ref to a plain object', () => {
		const obj = { hello: 'world' };
		const ref = valueRef({ get: () => obj });
		expect(ref.get()).toBe(obj);
	});
});
