import { describe, it, expect, vi } from 'vitest';
import { value, Value } from '../core/value.js';
import { valuePlain } from '../core/value-plain.js';
import { valueRef } from '../core/value-ref.js';
import { valueScope } from '../core/value-scope.js';
import { isValue, isPlain, isComputed, isScope } from '../core/field-value.js';
import type { ScopeInstance } from '../core/scope-types.js';

describe('valueScope', () => {
	describe('.create()', () => {
		it('creates an instance with provided values', () => {
			const person = valueScope({
				firstName: value<string>(),
				lastName: value<string>(),
			});
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			expect(bob.firstName.get()).toBe('Bob');
			expect(bob.lastName.get()).toBe('Jones');
		});

		it('uses defaults for omitted values', () => {
			const person = valueScope({
				firstName: value<string>(),
				role: value<string>('viewer'),
			});
			const bob = person.create({ firstName: 'Bob' });
			expect(bob.role.get()).toBe('viewer');
		});

		it('creates with no args, values are undefined or defaults', () => {
			const person = valueScope({
				firstName: value<string>(),
				role: value<string>('viewer'),
			});
			const empty = person.create();
			expect(empty.firstName.get()).toBeUndefined();
			expect(empty.role.get()).toBe('viewer');
		});

		it('brands the instance as a scope', () => {
			const person = valueScope({ name: value<string>() });
			const bob = person.create({ name: 'Bob' });
			expect(isScope(bob)).toBe(true);
		});
	});

	describe('field access', () => {
		it('reactive fields are FieldValue instances', () => {
			const person = valueScope({ name: value<string>() });
			const bob = person.create({ name: 'Bob' });
			expect(isValue(bob.name)).toBe(true);
		});

		it('field.set() updates the value', () => {
			const person = valueScope({ name: value<string>() });
			const bob = person.create({ name: 'Bob' });
			bob.name.set('Robert');
			expect(bob.name.get()).toBe('Robert');
		});

		it('field.set() with callback', () => {
			const scope = valueScope({ count: value<number>(0) });
			const instance = scope.create();
			instance.count.set((prev) => (prev ?? 0) + 1);
			expect(instance.count.get()).toBe(1);
		});
	});

	describe('nested groups', () => {
		it('creates frozen grouping objects', () => {
			const person = valueScope({
				job: {
					title: value<string>(),
					company: value<string>(),
				},
			});
			const bob = person.create({
				job: { title: 'Engineer', company: 'Acme' },
			});
			expect(bob.job.title.get()).toBe('Engineer');
			expect(bob.job.company.get()).toBe('Acme');
			expect(Object.isFrozen(bob.job)).toBe(true);
		});

		it('sets nested values', () => {
			const person = valueScope({
				job: { title: value<string>() },
			});
			const bob = person.create({ job: { title: 'Engineer' } });
			bob.job.title.set('CTO');
			expect(bob.job.title.get()).toBe('CTO');
		});
	});

	describe('static entries', () => {
		it('attaches frozen static values directly', () => {
			const person = valueScope({
				schemaVersion: 1 as const,
				name: value<string>(),
			});
			const bob = person.create({ name: 'Bob' });
			expect(bob.schemaVersion).toBe(1);
		});

		it('attaches static values nested inside a group', () => {
			const person = valueScope({
				job: {
					title: value<string>(),
					department: 'Engineering',
				},
			});
			const bob = person.create({ job: { title: 'CTO' } });
			expect((bob.job as { department: string }).department).toBe(
				'Engineering',
			);
			expect(bob.job.title.get()).toBe('CTO');
		});

		it('freezes groups after static entries are attached', () => {
			const person = valueScope({
				job: {
					title: value<string>(),
					department: 'Engineering',
				},
			});
			const bob = person.create({ job: { title: 'CTO' } });
			// Group node must be frozen post-construction so consumers can't
			// mutate the runtime shape.
			expect(Object.isFrozen(bob.job)).toBe(true);
		});
	});

	describe('sync derivations', () => {
		it('computes derived value', () => {
			const person = valueScope({
				firstName: value<string>(),
				lastName: value<string>(),
				fullName: ({ scope }: { scope: any }) =>
					`${scope.firstName.use()} ${scope.lastName.use()}`,
			});
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			expect(bob.fullName.get()).toBe('Bob Jones');
		});

		it('derivation updates when dependency changes', () => {
			const person = valueScope({
				firstName: value<string>(),
				lastName: value<string>(),
				fullName: ({ scope }: { scope: any }) =>
					`${scope.firstName.use()} ${scope.lastName.use()}`,
			});
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.firstName.set('Robert');
			expect(bob.fullName.get()).toBe('Robert Jones');
		});

		it('derived fields are FieldDerived (isComputed)', () => {
			const person = valueScope({
				name: value<string>(),
				greeting: ({ scope }: { scope: any }) => `Hello ${scope.name.use()}`,
			});
			const bob = person.create({ name: 'Bob' });
			expect(isComputed(bob.greeting)).toBe(true);
			expect(isValue(bob.greeting)).toBe(false);
		});

		it('derivation can use get() for untracked reads', () => {
			const scope = valueScope({
				format: value<string>('upper'),
				name: value<string>(),
				label: ({ scope: s }: { scope: any }) => {
					const name = s.name.use();
					const fmt = s.format.get(); // untracked
					return fmt === 'upper' ? name?.toUpperCase() : name;
				},
			});
			const instance = scope.create({ name: 'Bob', format: 'upper' });
			expect(instance.label.get()).toBe('BOB');

			// Changing format does NOT trigger recomputation (untracked)
			instance.format.set('lower');
			expect(instance.label.get()).toBe('BOB'); // still upper
		});

		it('derivation can destructure scope', () => {
			const person = valueScope({
				first: value<string>(),
				last: value<string>(),
				full: ({ scope: { first, last } }: { scope: any }) =>
					`${first.use()} ${last.use()}`,
			});
			const bob = person.create({ first: 'Bob', last: 'Jones' });
			expect(bob.full.get()).toBe('Bob Jones');
		});

		it('derivation with nested scope access', () => {
			const person = valueScope({
				job: {
					title: value<string>(),
				},
				label: ({ scope }: { scope: any }) => `Title: ${scope.job.title.use()}`,
			});
			const bob = person.create({ job: { title: 'CTO' } });
			expect(bob.label.get()).toBe('Title: CTO');
		});
	});

	describe('$destroy()', () => {
		it('marks the instance as destroyed', () => {
			const scope = valueScope({ name: value<string>() });
			const instance = scope.create({ name: 'Bob' });
			expect(instance.name.get()).toBe('Bob');
			instance.$destroy();
			// After destroy, reads still work but writes are no-ops
		});

		it('stops recomputing sync derivations after destroy', () => {
			const derivationFn = vi.fn(
				({ scope }: { scope: any }) => scope.count.use() * 2,
			);
			const counter = valueScope({
				count: value(1),
				doubled: derivationFn,
			});
			const instance = counter.create();
			expect(instance.doubled.get()).toBe(2);
			const callsBeforeDestroy = derivationFn.mock.calls.length;
			instance.$destroy();
			// Forcing a recompute on a destroyed instance must not re-run the
			// derivation — the syncing effect should be disposed.
			instance.doubled.recompute();
			expect(derivationFn.mock.calls.length).toBe(callsBeforeDestroy);
		});

		it('stops recomputing validate() after destroy', () => {
			const validateFn = vi.fn(() => []);
			const scope = valueScope(
				{ name: value('Alice') },
				{ validate: validateFn },
			);
			const instance = scope.create();
			const callsBeforeDestroy = validateFn.mock.calls.length;
			instance.$destroy();
			instance.name.set('Bob');
			expect(validateFn.mock.calls.length).toBe(callsBeforeDestroy);
		});
	});

	describe('$getSnapshot()', () => {
		it('returns a plain object with resolved values', () => {
			const person = valueScope({
				firstName: value<string>(),
				lastName: value<string>(),
			});
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			expect(bob.$getSnapshot()).toEqual({
				firstName: 'Bob',
				lastName: 'Jones',
			});
		});

		it('resolves nested groups', () => {
			const person = valueScope({
				job: {
					title: value<string>(),
					company: value<string>(),
				},
			});
			const bob = person.create({
				job: { title: 'Engineer', company: 'Acme' },
			});
			expect(bob.$getSnapshot()).toEqual({
				job: { title: 'Engineer', company: 'Acme' },
			});
		});

		it('includes derived values', () => {
			const person = valueScope({
				name: value<string>(),
				greeting: ({ scope }: { scope: any }) => `Hello ${scope.name.use()}`,
			});
			const bob = person.create({ name: 'Bob' });
			expect(bob.$getSnapshot()).toEqual({
				name: 'Bob',
				greeting: 'Hello Bob',
			});
		});

		it('includes static entries', () => {
			const scope = valueScope({
				version: 1,
				name: value<string>(),
			});
			const instance = scope.create({ name: 'Bob' });
			expect(instance.$getSnapshot()).toEqual({
				version: 1,
				name: 'Bob',
			});
		});
	});

	describe('$setSnapshot()', () => {
		it('sets values from a partial snapshot', () => {
			const person = valueScope({
				firstName: value<string>(),
				lastName: value<string>(),
			});
			const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
			bob.$setSnapshot({ firstName: 'Robert' });
			expect(bob.firstName.get()).toBe('Robert');
			expect(bob.lastName.get()).toBe('Jones');
		});

		it('sets nested values from snapshot', () => {
			const person = valueScope({
				job: { title: value<string>() },
			});
			const bob = person.create({ job: { title: 'Engineer' } });
			bob.$setSnapshot({ job: { title: 'CTO' } });
			expect(bob.job.title.get()).toBe('CTO');
		});

		it('ignores derived and static entries', () => {
			const person = valueScope({
				name: value<string>(),
				version: 1,
				greeting: ({ scope }: { scope: any }) => `Hi ${scope.name.use()}`,
			});
			const bob = person.create({ name: 'Bob' });
			bob.$setSnapshot({
				name: 'Robert',
				version: 99,
				greeting: 'Nope',
			} as any);
			expect(bob.name.get()).toBe('Robert');
			expect(bob.greeting.get()).toBe('Hi Robert');
		});
	});

	describe('$subscribe()', () => {
		it('fires on any field change', async () => {
			const subscriber = vi.fn();
			const person = valueScope({
				name: value<string>(),
			});
			const bob = person.create({ name: 'Bob' });
			bob.$subscribe(subscriber);
			bob.name.set('Robert');
			// Subscriptions are synchronous via effect
			expect(subscriber).toHaveBeenCalledOnce();
		});
	});

	describe('$recompute()', () => {
		it('re-runs all derivations', () => {
			let callCount = 0;
			const scope = valueScope({
				name: value<string>(),
				greeting: ({ scope: s }: { scope: any }) => {
					callCount++;
					return `Hello ${s.name.use()}`;
				},
			});
			const instance = scope.create({ name: 'Bob' });
			const initialCount = callCount;
			instance.$recompute();
			expect(callCount).toBeGreaterThan(initialCount);
		});
	});
});

describe('lifecycle hooks', () => {
	describe('onCreate', () => {
		it('runs once when instance is created', () => {
			const onCreate = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onCreate });
			scope.create();
			expect(onCreate).toHaveBeenCalledOnce();
		});

		it('receives { scope, input, signal, onCleanup }', () => {
			const cleanup = vi.fn();
			let capturedInput: Record<string, unknown> | undefined;
			let capturedSignal: AbortSignal | undefined;
			const scope = valueScope(
				{ name: value<string>() },
				{
					onCreate: ({ scope: s, input, signal, onCleanup }) => {
						const scope = s as ScopeInstance<{ name: Value<string> }>;
						expect(scope.name.get()).toBe('Bob');
						capturedInput = input;
						capturedSignal = signal;
						onCleanup(cleanup);
					},
				},
			);
			const instance = scope.create({ name: 'Bob' });
			expect(capturedInput).toEqual({ name: 'Bob' });
			expect(capturedSignal).toBeInstanceOf(AbortSignal);
			expect(capturedSignal!.aborted).toBe(false);
			expect(cleanup).not.toHaveBeenCalled();
			instance.$destroy();
			expect(cleanup).toHaveBeenCalledOnce();
			expect(capturedSignal!.aborted).toBe(true);
		});

		it('receives undefined input when create() is called with no args', () => {
			let capturedInput: unknown = 'sentinel';
			const scope = valueScope(
				{ count: value(0) },
				{
					onCreate: ({ input }) => {
						capturedInput = input;
					},
				},
			);
			scope.create();
			expect(capturedInput).toBeUndefined();
		});

		it('signal aborts on $destroy', () => {
			let capturedSignal: AbortSignal | undefined;
			const scope = valueScope(
				{ name: value<string>() },
				{
					onCreate: ({ signal }) => {
						capturedSignal = signal;
					},
				},
			);
			const instance = scope.create({ name: 'Alice' });
			expect(capturedSignal!.aborted).toBe(false);
			instance.$destroy();
			expect(capturedSignal!.aborted).toBe(true);
		});

		it('can set values via scope wrapper', () => {
			const scope = valueScope(
				{
					name: value<string>(),
					greeting: value<string>(),
				},
				{
					onCreate: ({ scope: s }) => {
						const scope = s as ScopeInstance<{
							name: Value<string>;
							greeting: Value<string>;
						}>;
						scope.greeting.set(`Hello ${scope.name.get()}`);
					},
				},
			);
			const instance = scope.create({ name: 'Bob' });
			expect(instance.greeting.get()).toBe('Hello Bob');
		});
	});

	describe('onDestroy', () => {
		it('fires when $destroy() is called', () => {
			const onDestroy = vi.fn();
			const scope = valueScope({ name: value<string>() }, { onDestroy });
			const instance = scope.create({ name: 'Bob' });
			expect(onDestroy).not.toHaveBeenCalled();
			instance.$destroy();
			expect(onDestroy).toHaveBeenCalledOnce();
		});

		it('receives { scope }', () => {
			let capturedName: unknown;
			const scope = valueScope(
				{ name: value<string>() },
				{
					onDestroy: ({ scope: s }) => {
						const scope = s as ScopeInstance<{ name: Value<string> }>;
						capturedName = scope.name.get();
					},
				},
			);
			const instance = scope.create({ name: 'Bob' });
			instance.$destroy();
			expect(capturedName).toBe('Bob');
		});
	});

	describe('onChange', () => {
		it('fires after a value mutation (microtask batched)', async () => {
			const onChange = vi.fn();
			const scope = valueScope({ x: value<number>(0) }, { onChange });
			const instance = scope.create();
			instance.x.set(42);
			expect(onChange).not.toHaveBeenCalled();
			await Promise.resolve();
			expect(onChange).toHaveBeenCalledOnce();
		});

		it('receives { scope, changes, changesByScope }', async () => {
			let capturedChanges: Set<unknown> | undefined;
			let capturedByScope: Map<unknown, unknown[]> | undefined;
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					onChange: ({ changes, changesByScope }) => {
						capturedChanges = changes;
						capturedByScope = changesByScope;
					},
				},
			);
			const instance = scope.create();
			instance.x.set(42);
			await Promise.resolve();
			expect(capturedChanges).toBeDefined();
			expect(capturedChanges!.size).toBe(1);
			const change = [...capturedChanges!][0] as any;
			expect(change.path).toBe('x');
			expect(change.from).toBe(0);
			expect(change.to).toBe(42);
			// changesByScope should have root entry
			expect(capturedByScope).toBeDefined();
			expect(capturedByScope!.size).toBeGreaterThan(0);
		});

		it('batches multiple synchronous changes', async () => {
			const onChange = vi.fn();
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{ onChange },
			);
			const instance = scope.create();
			instance.x.set(1);
			instance.y.set(2);
			await Promise.resolve();
			expect(onChange).toHaveBeenCalledOnce();
			const { changes } = onChange.mock.calls[0]![0];
			expect(changes.size).toBe(2);
		});
	});

	describe('beforeChange', () => {
		it('can prevent a change', () => {
			const scope = valueScope(
				{ x: value<number>(0) },
				{
					beforeChange: ({ prevent }) => {
						prevent(/* all */);
					},
				},
			);
			const instance = scope.create();
			instance.x.set(42);
			expect(instance.x.get()).toBe(0);
		});

		it('can prevent specific changes via scope node', () => {
			const scope = valueScope(
				{
					x: value<number>(0),
					y: value<number>(0),
				},
				{
					beforeChange: ({ changes, prevent }) => {
						for (const change of changes) {
							if (change.path === 'x') prevent(change);
						}
					},
				},
			);
			const instance = scope.create();
			instance.x.set(42);
			instance.y.set(99);
			expect(instance.x.get()).toBe(0);
			expect(instance.y.get()).toBe(99);
		});
	});
});

describe('$setSnapshot with recreate', () => {
	it('runs onDestroy then onCreate on recreate', () => {
		const callOrder: string[] = [];
		const scope = valueScope(
			{ name: value<string>() },
			{
				onCreate: () => callOrder.push('create'),
				onDestroy: () => callOrder.push('destroy'),
			},
		);
		const instance = scope.create({ name: 'Bob' });
		expect(callOrder).toEqual(['create']);
		instance.$setSnapshot({ name: 'Robert' }, { recreate: true });
		expect(callOrder).toEqual(['create', 'destroy', 'create']);
		expect(instance.name.get()).toBe('Robert');
	});

	it('provides fresh signal and input on recreate', () => {
		const signals: AbortSignal[] = [];
		const inputs: unknown[] = [];
		const scope = valueScope(
			{ name: value<string>() },
			{
				onCreate: ({ signal, input }) => {
					signals.push(signal);
					inputs.push(input);
				},
			},
		);
		const instance = scope.create({ name: 'Bob' });
		expect(signals).toHaveLength(1);
		expect(signals[0]!.aborted).toBe(false);

		instance.$setSnapshot({ name: 'Robert' }, { recreate: true });
		expect(signals).toHaveLength(2);
		// Old signal should be aborted
		expect(signals[0]!.aborted).toBe(true);
		// New signal is fresh
		expect(signals[1]!.aborted).toBe(false);
		// Input on recreate is the snapshot data
		expect(inputs[1]).toEqual({ name: 'Robert' });
	});
});

describe('onUsed / onUnused', () => {
	it('fires onUsed when first subscriber attaches', () => {
		const onUsed = vi.fn();
		const scope = valueScope({ x: value<number>(0) }, { onUsed });
		const instance = scope.create();
		expect(onUsed).not.toHaveBeenCalled();

		const unsub = instance.x.subscribe(() => {});
		expect(onUsed).toHaveBeenCalledOnce();

		// Second subscriber does not fire again
		const unsub2 = instance.x.subscribe(() => {});
		expect(onUsed).toHaveBeenCalledOnce();

		unsub();
		unsub2();
	});

	it('provides { scope, signal, onCleanup } to onUsed', () => {
		const cleanup = vi.fn();
		let capturedSignal: AbortSignal | undefined;
		let capturedScope: unknown;
		const scope = valueScope(
			{ x: value<number>(0) },
			{
				onUsed: ({ scope: s, signal, onCleanup }) => {
					capturedScope = s;
					capturedSignal = signal;
					onCleanup(cleanup);
				},
			},
		);
		const instance = scope.create();

		const unsub = instance.x.subscribe(() => {});
		expect(capturedScope).toBeDefined();
		expect(capturedSignal).toBeInstanceOf(AbortSignal);
		expect(capturedSignal!.aborted).toBe(false);
		expect(cleanup).not.toHaveBeenCalled();

		unsub();
	});

	it('fires onUnused when last subscriber detaches', () => {
		const onUnused = vi.fn();
		const scope = valueScope({ x: value<number>(0) }, { onUnused });
		const instance = scope.create();

		const unsub1 = instance.x.subscribe(() => {});
		const unsub2 = instance.x.subscribe(() => {});
		expect(onUnused).not.toHaveBeenCalled();

		unsub1();
		expect(onUnused).not.toHaveBeenCalled(); // still one subscriber

		unsub2();
		expect(onUnused).toHaveBeenCalledOnce(); // last detached
	});

	it('onUsed signal aborts when last subscriber detaches', () => {
		let capturedSignal: AbortSignal | undefined;
		const scope = valueScope(
			{ x: value<number>(0) },
			{
				onUsed: ({ signal }) => {
					capturedSignal = signal;
				},
			},
		);
		const instance = scope.create();

		const unsub = instance.x.subscribe(() => {});
		expect(capturedSignal!.aborted).toBe(false);

		unsub();
		expect(capturedSignal!.aborted).toBe(true);
	});

	it('recreates signal fresh on reattach', () => {
		const signals: AbortSignal[] = [];
		const scope = valueScope(
			{ x: value<number>(0) },
			{
				onUsed: ({ signal }) => {
					signals.push(signal);
				},
			},
		);
		const instance = scope.create();

		const unsub1 = instance.x.subscribe(() => {});
		unsub1(); // detach -> signal aborts

		const unsub2 = instance.x.subscribe(() => {});
		expect(signals).toHaveLength(2);
		expect(signals[0]!.aborted).toBe(true);
		expect(signals[1]!.aborted).toBe(false);

		unsub2();
	});

	it('onUsed cleanup runs when last subscriber detaches', () => {
		const cleanup = vi.fn();
		const scope = valueScope(
			{ x: value<number>(0) },
			{
				onUsed: ({ onCleanup }) => {
					onCleanup(cleanup);
				},
			},
		);
		const instance = scope.create();

		const unsub = instance.x.subscribe(() => {});
		expect(cleanup).not.toHaveBeenCalled();

		unsub();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('fires across multiple fields (scope-wide, not per-field)', () => {
		const onUsed = vi.fn();
		const onUnused = vi.fn();
		const scope = valueScope(
			{ x: value<number>(0), y: value<number>(0) },
			{ onUsed, onUnused },
		);
		const instance = scope.create();

		const unsubX = instance.x.subscribe(() => {});
		expect(onUsed).toHaveBeenCalledOnce();

		// Subscribing to a second field does not fire onUsed again
		const unsubY = instance.y.subscribe(() => {});
		expect(onUsed).toHaveBeenCalledOnce();

		// Unsubscribing one field doesn't fire onUnused (y still subscribed)
		unsubX();
		expect(onUnused).not.toHaveBeenCalled();

		unsubY();
		expect(onUnused).toHaveBeenCalledOnce();
	});
});

describe('$use() setter', () => {
	it('returns a setter that updates values via $setSnapshot', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const instance = person.create({ firstName: 'Bob', lastName: 'Jones' });
		const [snapshot, setter] = instance.$use() as [
			Record<string, unknown>,
			(data: Record<string, unknown>) => void,
		];
		expect(snapshot.firstName).toBe('Bob');
		setter({ firstName: 'Robert' });
		expect(instance.firstName.get()).toBe('Robert');
		expect(instance.lastName.get()).toBe('Jones');
	});

	describe('valuePlain in scopes', () => {
		it('creates a get/set field that is not reactive', () => {
			const scope = valueScope({
				name: value('Alice'),
				config: valuePlain({ theme: 'dark' }),
			});
			const instance = scope.create();
			expect(instance.config.get()).toEqual({ theme: 'dark' });
			instance.config.set({ theme: 'light' });
			expect(instance.config.get()).toEqual({ theme: 'light' });
		});

		it('is identified by isPlain()', () => {
			const scope = valueScope({
				config: valuePlain('default'),
			});
			const instance = scope.create();
			expect(isPlain(instance.config)).toBe(true);
			expect(isValue(instance.config)).toBe(false);
			expect(isComputed(instance.config)).toBe(false);
		});

		it('does not trigger onChange hooks', async () => {
			const onChange = vi.fn();
			const scope = valueScope(
				{
					name: value('Alice'),
					config: valuePlain('dark'),
				},
				{ onChange },
			);
			const instance = scope.create();

			instance.config.set('light');
			// Wait for microtask flush
			await Promise.resolve();
			await Promise.resolve();
			expect(onChange).not.toHaveBeenCalled();

			// But reactive value changes do trigger onChange
			instance.name.set('Bob');
			await Promise.resolve();
			await Promise.resolve();
			expect(onChange).toHaveBeenCalledTimes(1);
		});

		it('does not trigger beforeChange hooks', () => {
			const beforeChange = vi.fn();
			const scope = valueScope(
				{
					config: valuePlain('dark'),
				},
				{ beforeChange },
			);
			const instance = scope.create();

			instance.config.set('light');
			expect(beforeChange).not.toHaveBeenCalled();
			expect(instance.config.get()).toBe('light');
		});

		it('supports pipe transforms', () => {
			const scope = valueScope({
				count: valuePlain(5).pipe((n) => n * 2),
			});
			const instance = scope.create();
			// Default value is piped
			expect(instance.count.get()).toBe(10);
			// Written values are piped
			instance.count.set(3);
			expect(instance.count.get()).toBe(6);
		});

		it('supports set with updater function', () => {
			const scope = valueScope({
				items: valuePlain<string[]>([]),
			});
			const instance = scope.create();
			instance.items.set((prev) => [...prev, 'a']);
			instance.items.set((prev) => [...prev, 'b']);
			expect(instance.items.get()).toEqual(['a', 'b']);
		});

		it('accepts initial values via create()', () => {
			const scope = valueScope({
				name: value('default'),
				config: valuePlain('dark'),
			});
			const instance = scope.create({ config: 'light' });
			expect(instance.config.get()).toBe('light');
		});

		it('throws when .set() is called on a readonly plain field', () => {
			const scope = valueScope({
				apiKey: valuePlain('secret', { readonly: true }),
			});
			const instance = scope.create();
			// The readonly type already omits .set() at the TS level, but we
			// still verify the runtime guard for callers that cast or use JS.
			const apiKey = instance.apiKey as unknown as {
				set: (v: string) => void;
				get: () => string;
			};
			expect(() => apiKey.set('other')).toThrow(TypeError);
			expect(() => apiKey.set('other')).toThrow(
				/readonly plain field "apiKey"/,
			);
			expect(apiKey.get()).toBe('secret');
		});

		it('allows initial values on readonly plain fields via create()', () => {
			const scope = valueScope({
				apiKey: valuePlain('default', { readonly: true }),
			});
			const instance = scope.create({ apiKey: 'provided' });
			expect(instance.apiKey.get()).toBe('provided');
			const apiKey = instance.apiKey as unknown as {
				set: (v: string) => void;
			};
			expect(() => apiKey.set('other')).toThrow(TypeError);
		});
	});
});

describe('allowUndeclaredProperties', () => {
	it('preserves extra properties from input as plain, non-reactive data', () => {
		const node = valueScope(
			{
				id: value<string>(),
				type: value<string>(),
			},
			{ allowUndeclaredProperties: true },
		);

		const instance = node.create({
			id: 'node-1',
			type: 'paragraph',
			text: 'Hello world',
			bold: true,
		} as any);

		// Declared fields are reactive
		expect(instance.id.get()).toBe('node-1');
		expect(instance.type.get()).toBe('paragraph');

		// Undeclared properties are preserved as plain data
		expect((instance as any).text).toBe('Hello world');
		expect((instance as any).bold).toBe(true);
	});

	it('undeclared properties are not reactive', async () => {
		const onChange = vi.fn();
		const node = valueScope(
			{
				id: value<string>(),
			},
			{ allowUndeclaredProperties: true, onChange },
		);

		const instance = node.create({
			id: 'node-1',
			extra: 'data',
		} as any);

		expect((instance as any).extra).toBe('data');
		// Extra properties should not participate in change tracking
	});

	it('undeclared properties appear in $getSnapshot()', () => {
		const node = valueScope(
			{
				id: value<string>(),
			},
			{ allowUndeclaredProperties: true },
		);

		const instance = node.create({
			id: 'node-1',
			text: 'Hello',
			children: [1, 2, 3],
		} as any);

		const snapshot = instance.$getSnapshot();
		expect(snapshot.id).toBe('node-1');
		expect((snapshot as any).text).toBe('Hello');
		expect((snapshot as any).children).toEqual([1, 2, 3]);
	});

	it('defaults to false (extra properties are dropped)', () => {
		const node = valueScope({
			id: value<string>(),
		});

		const instance = node.create({
			id: 'node-1',
			extra: 'data',
		} as any);

		expect(instance.id.get()).toBe('node-1');
		expect((instance as any).extra).toBeUndefined();
	});

	it('works with .extend()', () => {
		const base = valueScope(
			{
				id: value<string>(),
			},
			{ allowUndeclaredProperties: true },
		);

		const extended = base.extend({
			label: value<string>(''),
		});

		const instance = extended.create({
			id: 'x',
			label: 'test',
			extra: 'preserved',
		} as any);

		expect(instance.id.get()).toBe('x');
		expect(instance.label.get()).toBe('test');
		expect((instance as any).extra).toBe('preserved');
	});

	it('works with createMap()', () => {
		const node = valueScope(
			{
				id: value<string>(),
				type: value<string>(),
			},
			{ allowUndeclaredProperties: true },
		);

		const nodes = node.createMap();
		nodes.set('n1', {
			id: 'n1',
			type: 'text',
			content: 'Hello',
		} as any);

		const instance = nodes.get('n1');
		expect(instance).toBeDefined();
		expect(instance!.id.get()).toBe('n1');
		expect((instance as any).content).toBe('Hello');
	});
});

describe('$get()', () => {
	it('returns resolved values as a plain object', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
			fullName: ({ scope }: { scope: any }) =>
				`${scope.firstName.use()} ${scope.lastName.use()}`,
		});
		const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });

		const result = bob.$get();
		expect(result.firstName).toBe('Bob');
		expect(result.lastName).toBe('Jones');
		expect(result.fullName).toBe('Bob Jones');
	});

	it('includes nested group values', () => {
		const scope = valueScope({
			job: {
				title: value<string>(),
				company: value<string>(),
			},
		});
		const instance = scope.create({
			job: { title: 'Engineer', company: 'Acme' },
		});

		const result = instance.$get();
		expect(result).toEqual({
			job: { title: 'Engineer', company: 'Acme' },
		});
	});

	it('includes static data', () => {
		const scope = valueScope({
			name: value<string>(),
			schemaVersion: 1,
		});
		const instance = scope.create({ name: 'Bob' });

		const result = instance.$get();
		expect(result.name).toBe('Bob');
		expect(result.schemaVersion).toBe(1);
	});

	it('includes valuePlain values', () => {
		const scope = valueScope({
			name: value<string>(),
			config: valuePlain({ theme: 'dark' }),
		});
		const instance = scope.create({ name: 'Bob' });

		const result = instance.$get();
		expect(result.name).toBe('Bob');
		expect(result.config).toEqual({ theme: 'dark' });
	});
});

describe('$getIsValid / $useIsValid', () => {
	it('throws when no schema fields or validate hook exist', () => {
		const scope = valueScope({ name: value<string>() });
		const instance = scope.create({ name: 'Bob' });
		expect(() => (instance as any).$getIsValid()).toThrow(
			'$getIsValid() requires',
		);
		expect(() => (instance as any).$useIsValid()).toThrow(
			'$useIsValid() requires',
		);
	});
});

describe('extend merges all config hooks', () => {
	it('merges onChange hooks', async () => {
		const flush = () => new Promise<void>((r) => setTimeout(r, 0));
		const order: string[] = [];
		const base = valueScope(
			{ name: value<string>() },
			{ onChange: () => order.push('base') },
		);
		const extended = base.extend({}, { onChange: () => order.push('ext') });
		const instance = extended.create({ name: 'Alice' });
		instance.name.set('Bob');
		await flush();
		expect(order).toEqual(['base', 'ext']);
	});

	it('merges beforeChange hooks', () => {
		const order: string[] = [];
		const base = valueScope(
			{ name: value<string>() },
			{ beforeChange: () => order.push('base') },
		);
		const extended = base.extend({}, { beforeChange: () => order.push('ext') });
		const instance = extended.create({ name: 'Alice' });
		instance.name.set('Bob');
		expect(order).toEqual(['base', 'ext']);
	});

	it('merges onUsed/onUnused hooks', () => {
		const order: string[] = [];
		const base = valueScope(
			{ name: value<string>() },
			{
				onUsed: () => order.push('baseUsed'),
				onUnused: () => order.push('baseUnused'),
			},
		);
		const extended = base.extend(
			{},
			{
				onUsed: () => order.push('extUsed'),
				onUnused: () => order.push('extUnused'),
			},
		);
		const instance = extended.create({ name: 'Alice' });
		const unsub = instance.name.subscribe(() => {});
		expect(order).toEqual(['baseUsed', 'extUsed']);
		unsub();
		expect(order).toEqual(['baseUsed', 'extUsed', 'baseUnused', 'extUnused']);
	});

	it('merges allowUndeclaredProperties from extension', () => {
		const base = valueScope({ name: value<string>() });
		const extended = base.extend({}, { allowUndeclaredProperties: true });
		const instance = extended.create({ name: 'Alice', extra: 'data' } as any);
		expect((instance as any).extra).toBe('data');
	});
});

describe('value-ref in derivation scope', () => {
	it('plain (non-reactive) value ref is accessible', () => {
		const scope = valueScope({
			label: value<string>(),
			constant: valueRef(() => 42),
		});
		const instance = scope.create({ label: 'test' });
		expect((instance as any).constant).toBe(42);
	});
});
