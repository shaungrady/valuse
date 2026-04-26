import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueRef } from '../core/value-ref.js';
import { valueScope } from '../core/value-scope.js';
import { ScopeMap } from '../core/scope-map.js';

describe('ref .use() in derivations — factory ref to ScopeMap', () => {
	it('scope.<mapRef>.use() returns the ScopeMap', () => {
		const column = valueScope({ name: value<string>() });
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
			columnsReadback: ({ scope }: { scope: any }) => scope.columns.use(),
		});
		const instance = board.create();
		expect(instance.columnsReadback.get()).toBeInstanceOf(ScopeMap);
	});

	it('derivation reading .size re-runs when an entry is added', () => {
		const column = valueScope({ name: value<string>() });
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
			columnCount: ({ scope }: { scope: any }) => scope.columns.use().size,
		});
		const instance = board.create();
		expect(instance.columnCount.get()).toBe(0);

		(instance as any).columns.set('a', { name: 'Alpha' });
		expect(instance.columnCount.get()).toBe(1);

		(instance as any).columns.set('b', { name: 'Beta' });
		expect(instance.columnCount.get()).toBe(2);
	});

	it('derivation re-runs when an entry is removed', () => {
		const column = valueScope({ name: value<string>() });
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
			columnCount: ({ scope }: { scope: any }) => scope.columns.use().size,
		});
		const instance = board.create();
		(instance as any).columns.set('a', { name: 'Alpha' });
		(instance as any).columns.set('b', { name: 'Beta' });
		expect(instance.columnCount.get()).toBe(2);

		(instance as any).columns.delete('a');
		expect(instance.columnCount.get()).toBe(1);
	});

	it('derivation re-runs on clear()', () => {
		const column = valueScope({ name: value<string>() });
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
			empty: ({ scope }: { scope: any }) => scope.columns.use().size === 0,
		});
		const instance = board.create();
		(instance as any).columns.set('a', { name: 'Alpha' });
		expect(instance.empty.get()).toBe(false);

		(instance as any).columns.clear();
		expect(instance.empty.get()).toBe(true);
	});

	it('.get() is an untracked read', () => {
		const column = valueScope({ name: value<string>() });
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
			// Mixed read: track nothing on the outer map, just snapshot it
			// at derivation-setup time.
			initialSize: ({ scope }: { scope: any }) => scope.columns.get().size,
		});
		const instance = board.create();
		expect(instance.initialSize.get()).toBe(0);

		(instance as any).columns.set('a', { name: 'Alpha' });
		// Derivation should NOT re-run because .get() does not track.
		expect(instance.initialSize.get()).toBe(0);
	});

	it('granularity: mutating an entry field does not re-run a .size-only derivation', () => {
		const column = valueScope({ name: value<string>() });
		const runs = vi.fn<(n: number) => number>((n) => n);
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
			columnCount: ({ scope }: { scope: any }) =>
				runs(scope.columns.use().size),
		});
		const instance = board.create();

		instance.columnCount.subscribe(() => {});
		runs.mockClear();

		(instance as any).columns.set('a', { name: 'Alpha' });
		expect(runs).toHaveBeenCalledTimes(1);

		const entry = (instance as any).columns.get('a');
		entry.name.set('Alpha v2');
		// Renaming an entry field should not re-run a derivation that only
		// depends on the key-list size.
		expect(runs).toHaveBeenCalledTimes(1);
	});

	it('instance tree still exposes the raw ScopeMap (not the wrapper)', () => {
		const column = valueScope({ name: value<string>() });
		const board = valueScope({
			columns: valueRef(() => column.createMap()),
		});
		const instance = board.create();
		expect((instance as any).columns).toBeInstanceOf(ScopeMap);
	});
});

describe('ref .use() in derivations — factory ref to a scope instance', () => {
	it('scope.<instanceRef>.use() returns the instance itself', () => {
		const user = valueScope({ name: value<string>('Alice') });
		const app = valueScope({
			currentUser: valueRef(() => user.create()),
			userReadback: ({ scope }: { scope: any }) => scope.currentUser.use(),
		});
		const instance = app.create();
		const readback = instance.userReadback.get() as any;
		expect(typeof readback.$get).toBe('function');
		expect(readback.name.get()).toBe('Alice');
	});

	it('derivation re-runs when a field on the inner scope changes', () => {
		const user = valueScope({
			name: value<string>('Alice'),
			displayName: ({ scope }: { scope: any }) => scope.name.use(),
		});
		const app = valueScope({
			currentUser: valueRef(() => user.create()),
			greeting: ({ scope }: { scope: any }) =>
				`Hello, ${scope.currentUser.use().displayName.get()}`,
		});
		const instance = app.create();
		expect(instance.greeting.get()).toBe('Hello, Alice');

		(instance as any).currentUser.name.set('Bob');
		expect(instance.greeting.get()).toBe('Hello, Bob');
	});

	it('instance tree still exposes the raw scope instance (not the wrapper)', () => {
		const user = valueScope({ name: value<string>() });
		const app = valueScope({
			currentUser: valueRef(() => user.create()),
		});
		const instance = app.create();
		expect(typeof (instance as any).currentUser.$get).toBe('function');
	});
});

describe('ref .use() in derivations — shared ref to a scope instance', () => {
	it('scope.<ref>.use() returns the shared instance itself', () => {
		const user = valueScope({ name: value<string>('Alice') });
		const sharedUser = user.create();
		const app = valueScope({
			currentUser: valueRef(sharedUser),
			userReadback: ({ scope }: { scope: any }) => scope.currentUser.use(),
		});
		const instance = app.create();
		expect(instance.userReadback.get()).toBe(sharedUser);
	});

	it('derivation re-runs when the shared instance mutates externally', () => {
		const user = valueScope({ name: value<string>('Alice') });
		const sharedUser = user.create();
		const app = valueScope({
			currentUser: valueRef(sharedUser),
			greeting: ({ scope }: { scope: any }) =>
				`Hello, ${scope.currentUser.use().name.get()}`,
		});
		const instance = app.create();
		expect(instance.greeting.get()).toBe('Hello, Alice');

		sharedUser.name.set('Bob');
		expect(instance.greeting.get()).toBe('Hello, Bob');
	});

	it('can call $ methods on the referenced instance inside a derivation', () => {
		const user = valueScope({ name: value<string>('Alice') });
		const sharedUser = user.create();
		const app = valueScope({
			currentUser: valueRef(sharedUser),
			snapshot: ({ scope }: { scope: any }) => scope.currentUser.use().$get(),
		});
		const instance = app.create();
		expect(instance.snapshot.get()).toEqual({ name: 'Alice' });
	});
});

describe('ref .use() in derivations — regression: shared ref to Value', () => {
	it('still returns the primitive value', () => {
		const counter = value<number>(1);
		const app = valueScope({
			counter: valueRef(counter),
			doubled: ({ scope }: { scope: any }) => scope.counter.use() * 2,
		});
		const instance = app.create();
		expect(instance.doubled.get()).toBe(2);

		counter.set(5);
		expect(instance.doubled.get()).toBe(10);
	});

	it('still returns the primitive value for factory refs to Value', () => {
		const app = valueScope({
			counter: valueRef(() => value<number>(7)),
			doubled: ({ scope }: { scope: any }) => scope.counter.use() * 2,
		});
		const instance = app.create();
		expect(instance.doubled.get()).toBe(14);

		(instance as any).counter.set(10);
		expect(instance.doubled.get()).toBe(20);
	});
});

describe('ref .use() in derivations — nested', () => {
	it('grandparent -> parent factory ref -> map ref works in a root derivation', () => {
		const column = valueScope({ title: value<string>() });
		const parent = valueScope({
			columns: valueRef(() => column.createMap()),
			count: ({ scope }: { scope: any }) => scope.columns.use().size,
		});
		const app = valueScope({
			inner: valueRef(() => parent.create()),
			label: ({ scope }: { scope: any }) =>
				`count=${scope.inner.use().count.get()}`,
		});
		const instance = app.create();
		expect(instance.label.get()).toBe('count=0');

		(instance as any).inner.columns.set('a', { title: 'A' });
		expect(instance.label.get()).toBe('count=1');
	});
});
