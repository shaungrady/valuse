import { describe, it, expect, vi } from 'vitest';
import { value, valueScope } from '../index.js';

describe('per-field subscribe', () => {
	describe('ScopeInstance', () => {
		it('fires when the subscribed field changes', () => {
			const scope = valueScope({
				email: value<string>(''),
				name: value<string>(''),
			});
			const instance = scope.create();
			const handler = vi.fn();

			instance.subscribe('email', handler);
			instance.set('email', 'alice@test.com');

			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith('alice@test.com', '');
		});

		it('does not fire when a different field changes', () => {
			const scope = valueScope({
				email: value<string>(''),
				name: value<string>(''),
			});
			const instance = scope.create();
			const handler = vi.fn();

			instance.subscribe('email', handler);
			instance.set('name', 'Alice');

			expect(handler).not.toHaveBeenCalled();
		});

		it('receives previousValue correctly across multiple updates', () => {
			const scope = valueScope({ x: value<number>(0) });
			const instance = scope.create();
			const calls: [number, number][] = [];

			instance.subscribe('x', (value, previousValue) => {
				calls.push([value, previousValue]);
			});

			instance.set('x', 1);
			instance.set('x', 2);
			instance.set('x', 3);

			expect(calls).toEqual([
				[1, 0],
				[2, 1],
				[3, 2],
			]);
		});

		it('unsubscribe stops further notifications', () => {
			const scope = valueScope({ x: value<number>(0) });
			const instance = scope.create();
			const handler = vi.fn();

			const unsub = instance.subscribe('x', handler);
			instance.set('x', 1);
			expect(handler).toHaveBeenCalledOnce();

			unsub();
			instance.set('x', 2);
			expect(handler).toHaveBeenCalledOnce();
		});

		it('triggers onUsed/onUnused lifecycle hooks', () => {
			const onUsed = vi.fn();
			const onUnused = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onUsed, onUnused });
			const instance = scope.create();

			const unsub = instance.subscribe('x', () => {});
			expect(onUsed).toHaveBeenCalledOnce();

			unsub();
			expect(onUnused).toHaveBeenCalledOnce();
		});

		it('works on derivation fields (read-only)', () => {
			const scope = valueScope({
				first: value<string>('Alice'),
				last: value<string>('Smith'),
				full: ({ use }: { use: (key: string) => string }) =>
					`${use('first')} ${use('last')}`,
			});
			const instance = scope.create();
			const handler = vi.fn();

			instance.subscribe('full', handler);
			instance.set('first', 'Bob');

			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith('Bob Smith', 'Alice Smith');
		});

		it('returns noop for unknown fields', () => {
			const scope = valueScope({ x: value<number>(0) });
			const instance = scope.create();

			const unsub = instance.subscribe('nonexistent' as never, vi.fn());
			expect(typeof unsub).toBe('function');
			unsub(); // should not throw
		});
	});

	describe('ScopeMap', () => {
		it('delegates to instance subscribe', () => {
			const scope = valueScope({
				email: value<string>(''),
				name: value<string>(''),
			});
			const people = scope.createMap(
				new Map([['alice', { email: 'alice@old.com', name: 'Alice' }]]),
			);
			const handler = vi.fn();

			people.subscribe('alice', 'email', handler);
			people.get('alice')!.set('email', 'alice@new.com');

			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith('alice@new.com', 'alice@old.com');
		});

		it('does not fire for other fields on the same instance', () => {
			const scope = valueScope({
				email: value<string>(''),
				name: value<string>(''),
			});
			const people = scope.createMap(
				new Map([['alice', { email: 'alice@test.com', name: 'Alice' }]]),
			);
			const handler = vi.fn();

			people.subscribe('alice', 'email', handler);
			people.get('alice')!.set('name', 'Alicia');

			expect(handler).not.toHaveBeenCalled();
		});

		it('returns noop for non-existent keys', () => {
			const scope = valueScope({ x: value<number>(0) });
			const people = scope.createMap<string>();

			const unsub = people.subscribe('nobody', 'x', vi.fn());
			expect(typeof unsub).toBe('function');
			unsub(); // should not throw
		});
	});
});
