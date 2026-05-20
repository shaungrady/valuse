import { describe, it, expect, vi } from 'vitest';
import { value, Value } from '../core/value.js';
import { valuePlain } from '../core/value-plain.js';
import { valueRef } from '../core/value-ref.js';
import { valueScope } from '../core/value-scope.js';
import { valueSet } from '../core/value-set.js';
import { valueMap } from '../core/value-map.js';
import { valueArray } from '../core/value-array.js';
import { isValue, isPlain, isComputed, isScope } from '../core/field-value.js';
import { pipeDebounce } from '../utils/pipe-debounce.js';
import { pipeBatch } from '../utils/pipe-batch.js';
import { batchSets } from '../core/signal.js';
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

		/**
		 * Bug: a sync derivation that throws (e.g. dereferencing a value
		 * that's just been set to null) used to propagate the error out of
		 * `set()` on the source field. The write itself landed, but the
		 * derived slot held its stale value, and the caller — who had no
		 * direct relationship to the derivation — got hit with an
		 * unhandled exception.
		 *
		 * Contract: a throwing derivation must not poison the source
		 * `set()`. The source write succeeds, the derived slot holds its
		 * last good value, and the next non-throwing write recovers.
		 */
		describe('throw containment in sync derivations', () => {
			it('throw inside derivation does not propagate out of source .set()', () => {
				const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
				const person = valueScope({
					firstName: value<string | null>(),
					upper: ({ scope }: { scope: any }) =>
						(scope.firstName.use() as string).toUpperCase(),
				});
				const bob = person.create({ firstName: 'bob' });
				expect(bob.upper.get()).toBe('BOB');

				expect(() => bob.firstName.set(null)).not.toThrow();
				expect(bob.firstName.get()).toBeNull();
				expect(errSpy).toHaveBeenCalled();
				errSpy.mockRestore();
			});

			it('derived slot keeps the last good value when derivation throws', () => {
				const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
				const person = valueScope({
					firstName: value<string | null>(),
					upper: ({ scope }: { scope: any }) =>
						(scope.firstName.use() as string).toUpperCase(),
				});
				const bob = person.create({ firstName: 'bob' });
				expect(bob.upper.get()).toBe('BOB');
				bob.firstName.set(null);
				expect(bob.upper.get()).toBe('BOB');
				errSpy.mockRestore();
			});

			it('next non-throwing write recovers the derivation', () => {
				const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
				const person = valueScope({
					firstName: value<string | null>(),
					upper: ({ scope }: { scope: any }) =>
						(scope.firstName.use() as string).toUpperCase(),
				});
				const bob = person.create({ firstName: 'bob' });
				bob.firstName.set(null);
				bob.firstName.set('alice');
				expect(bob.upper.get()).toBe('ALICE');
				errSpy.mockRestore();
			});
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

		/**
		 * Bug: `$setSnapshot({ job: 'CEO' })` against a `job` group used
		 * to be a silent no-op — the recursion required `value` to be a
		 * plain object, and a string at a group path just dropped on the
		 * floor with no diagnostic. Surface a `console.warn` so the user
		 * sees their misshapen write.
		 *
		 * Partial snapshots (missing keys) remain tolerated, since that
		 * is the documented use case.
		 */
		describe('shape mismatch diagnostics', () => {
			it('warns when a group path receives a non-object value', () => {
				const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
				const person = valueScope({
					job: { title: value<string>() },
				});
				const bob = person.create({ job: { title: 'Engineer' } });
				bob.$setSnapshot({ job: 'CEO' } as any);
				// No write happened — the group value is unchanged.
				expect(bob.job.title.get()).toBe('Engineer');
				expect(warnSpy).toHaveBeenCalled();
				warnSpy.mockRestore();
			});

			it('does NOT warn for partial snapshots (missing keys)', () => {
				const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
				const person = valueScope({
					firstName: value<string>(),
					lastName: value<string>(),
				});
				const bob = person.create({ firstName: 'Bob', lastName: 'Jones' });
				bob.$setSnapshot({ firstName: 'Robert' });
				expect(warnSpy).not.toHaveBeenCalled();
				warnSpy.mockRestore();
			});
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

		/**
		 * Bug: a throwing `$subscribe` callback used to propagate out of
		 * the source `.set()` via Preact's endBatch, breaking siblings.
		 */
		it('a throwing $subscribe callback does not poison .set()', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const person = valueScope({
				name: value<string>(),
			});
			const bob = person.create({ name: 'Bob' });
			const after = vi.fn();
			bob.$subscribe(() => {
				throw new Error('boom');
			});
			bob.$subscribe(after);
			expect(() => bob.name.set('Robert')).not.toThrow();
			expect(bob.name.get()).toBe('Robert');
			expect(after).toHaveBeenCalledOnce();
			errSpy.mockRestore();
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

		/**
		 * Bug: `onChange` runs on a microtask, and `#scheduleOnChange`
		 * clears its "scheduled" flag at the *start* of the microtask. A
		 * `.set()` made *inside* an `onChange` callback therefore always
		 * schedules another microtask, which fires another `onChange`,
		 * which writes again, ad infinitum. The page hangs silently.
		 *
		 * Contract: detect a chain of reentry-driven reschedules and break
		 * out with a `console.error`, so the page recovers and the user
		 * sees a clear diagnostic instead of an unexplained freeze.
		 */
		it('breaks out of an onChange re-entry loop with a diagnostic', async () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const scope = valueScope(
				{ tick: value<number>(0) },
				{
					onChange: ({ scope: s }: { scope: any }) => {
						s.tick.set((n: number | undefined) => (n ?? 0) + 1);
					},
				},
			);
			const instance = scope.create({ tick: 0 });
			instance.tick.set(1);

			// Drain microtasks. If the loop is not broken, the test would
			// time out here. Cap the drain count well above the loop
			// detection threshold so we exit even if the guard misfires.
			for (let i = 0; i < 500; i++) {
				await Promise.resolve();
			}

			expect(errSpy).toHaveBeenCalled();
			const stable = instance.tick.get();
			// After a further drain, the value should not keep growing.
			for (let i = 0; i < 50; i++) await Promise.resolve();
			expect(instance.tick.get()).toBe(stable);
			errSpy.mockRestore();
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

		/**
		 * Contract: `beforeChange` is fundamentally per-write, in contrast
		 * to `onChange` which is microtask-batched. Each `.set()` call
		 * fires `beforeChange` synchronously with `changes.size === 1`,
		 * and `prevent()` decisions are made against that single write.
		 *
		 * `batchSets` defers Preact's downstream effect propagation but
		 * does NOT collapse `beforeChange` invocations into one — that
		 * would change the prevent semantics (a "prevent this change"
		 * call would need to mean "prevent this individual write" anyway,
		 * since each write is independently veto-able).
		 *
		 * Pinning this so future refactors don't quietly change it.
		 */
		it('beforeChange fires per-write with changes.size === 1', () => {
			const sizes: number[] = [];
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: ({ changes }) => {
						sizes.push(changes.size);
					},
				},
			);
			const instance = scope.create();
			instance.x.set(1);
			instance.y.set(2);
			expect(sizes).toEqual([1, 1]);
		});

		it('beforeChange still fires per-write inside batchSets', () => {
			const sizes: number[] = [];
			const scope = valueScope(
				{ x: value<number>(0), y: value<number>(0) },
				{
					beforeChange: ({ changes }) => {
						sizes.push(changes.size);
					},
				},
			);
			const instance = scope.create();
			batchSets(() => {
				instance.x.set(1);
				instance.y.set(2);
			});
			expect(sizes).toEqual([1, 1]);
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

	/**
	 * Bug: recreate used to truncate the same `createCleanups` array
	 * that held the sync `effect()` disposer and the async-derivation
	 * abort+unsubscribe disposer. After one recreate the derivation
	 * infrastructure was torn down with no path to rebuild it, so all
	 * derivations silently stopped reacting to dep changes.
	 *
	 * Recreate is about the user-facing onCreate/onDestroy lifecycle. It must
	 * leave the per-instance derivation wiring intact.
	 */
	it('sync derivations keep recomputing after recreate', () => {
		const scope = valueScope({
			n: value<number>(1),
			doubled: ({ scope }: { scope: any }) => scope.n.use() * 2,
		});
		const instance = scope.create({ n: 1 });
		expect(instance.doubled.get()).toBe(2);

		instance.$setSnapshot({ n: 3 }, { recreate: true });
		expect(instance.doubled.get()).toBe(6);

		instance.n.set(4);
		expect(instance.doubled.get()).toBe(8);
	});

	it('async derivations keep reacting to dep changes after recreate', async () => {
		const flush = () => new Promise<void>((r) => setTimeout(r, 0));
		const scope = valueScope({
			id: value<string>('a'),
			result: async ({ scope: s }: { scope: any }) => `loaded:${s.id.use()}`,
		});
		const instance = scope.create({ id: 'a' });
		await flush();
		expect(instance.result.get()).toBe('loaded:a');

		instance.$setSnapshot({ id: 'b' }, { recreate: true });
		await flush();
		instance.id.set('c');
		await flush();
		expect(instance.result.get()).toBe('loaded:c');
	});
});

/**
 * Bug: `$destroy()` had no "already destroyed" guard, so each call
 * re-fired `config.onDestroy`, re-ran the same cleanup list, and cascaded a
 * second `$destroy` into every factory-ref child. The bug surfaced naturally
 * because `ScopeMap.delete(key)` calls `$destroy()` internally — any caller
 * who also held the instance reference and called `$destroy()` themselves
 * tripped it.
 */
describe('$destroy idempotency', () => {
	it('calling $destroy() twice fires onDestroy only once', () => {
		const onDestroy = vi.fn();
		const scope = valueScope({ x: value<number>(0) }, { onDestroy });
		const instance = scope.create();
		instance.$destroy();
		instance.$destroy();
		expect(onDestroy).toHaveBeenCalledOnce();
	});

	it('ScopeMap.delete + manual $destroy fires factory-ref onDestroy only once', () => {
		const childOnDestroy = vi.fn();
		const child = valueScope(
			{ name: value<string>() },
			{ onDestroy: childOnDestroy },
		);
		const parent = valueScope({
			kids: valueRef(() => child.createMap()),
		});
		const root = parent.create();
		const kids = (root as any).kids;
		kids.set('a', { name: 'A' });
		const aInstance = kids.get('a');

		kids.delete('a');
		aInstance.$destroy();

		expect(childOnDestroy).toHaveBeenCalledOnce();
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

		/**
		 * Bug: plain fields are documented as "inert" — writes must not
		 * trigger derivations, `$subscribe` callbacks, devtools, or history.
		 *
		 * `onChange`/`beforeChange` were already correctly skipped (the
		 * write-time hook calls early-return for `kind === 'plain'`), but the
		 * plain value was still stored in the same Preact-signal slot as
		 * reactive fields. Any effect tracking that signal (the per-instance
		 * `$subscribe` effect, `$useSnapshot`'s snapshot-invalidation effect,
		 * `_trackAll` for ref-instance use(), and any derivation that called
		 * `scope.<plainField>.use()`) was therefore notified on every plain
		 * write — directly contradicting the docs.
		 *
		 * The fix moves plain values out of the signal array into a separate
		 * `Map`, with a coarse "plain version" signal that only the snapshot
		 * cache invalidator tracks. That keeps `$getSnapshot()` returning
		 * fresh data while leaving every other reactive consumer untouched.
		 */
		describe('valuePlain inertness vs the reactive graph', () => {
			it('does not fire $subscribe', () => {
				const scope = valueScope({
					name: value('Alice'),
					config: valuePlain('dark'),
				});
				const instance = scope.create();

				const sub = vi.fn();
				instance.$subscribe(sub);

				instance.config.set('light');
				// Wait through two microtask hops — Preact batches subscriber
				// notifications onto a follow-up microtask, so a single
				// `Promise.resolve()` await would land before the batch flush.
				return Promise.resolve()
					.then(() => undefined)
					.then(() => {
						expect(sub).not.toHaveBeenCalled();
						instance.name.set('Bob');
						return Promise.resolve().then(() => undefined);
					})
					.then(() => {
						expect(sub).toHaveBeenCalled();
					});
			});

			it('does not re-run sync derivations that .use() the plain field', () => {
				let runs = 0;
				const scope = valueScope({
					config: valuePlain('dark'),
					derived: ({ scope: s }: { scope: any }) => {
						runs++;
						return s.config.use() + '!';
					},
				});
				const instance = scope.create();
				expect(runs).toBe(1);
				expect(instance.derived.get()).toBe('dark!');

				instance.config.set('light');
				// Plain is inert — derivation should not have re-run.
				expect(runs).toBe(1);
			});

			it('does not re-run async derivations that .use() the plain field', async () => {
				const flush = () => new Promise<void>((r) => setTimeout(r, 0));
				let runs = 0;
				const scope = valueScope({
					config: valuePlain('dark'),
					result: async ({ scope: s }: { scope: any }) => {
						runs++;
						return s.config.use() + '!';
					},
				});
				const instance = scope.create();
				await flush();
				expect(runs).toBe(1);
				expect(instance.result.get()).toBe('dark!');

				instance.config.set('light');
				await flush();
				expect(runs).toBe(1);
			});

			it('$getSnapshot() reads the freshest plain value', () => {
				const scope = valueScope({
					name: value('Alice'),
					config: valuePlain('dark'),
				});
				const instance = scope.create();

				expect(instance.$getSnapshot()).toEqual({
					name: 'Alice',
					config: 'dark',
				});

				instance.config.set('light');
				expect(instance.$getSnapshot()).toEqual({
					name: 'Alice',
					config: 'light',
				});
			});
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

/**
 * Bug: `valueSet`/`valueMap`/`valueArray` placed directly in a scope
 * definition fell through `scope-definition.ts`'s type dispatch (they're
 * objects but not Value/ValueSchema/ValuePlain/ValueRef/function/plain
 * object) and were attached as **static** entries — meaning every instance
 * created from the template shared the same collection reference. Mutating
 * `alice.hobbies` therefore mutated `bob.hobbies`, breaking the "creating
 * independent instances doesn't require factory wrappers" promise from the
 * README and the documented example (`hobbies: valueSet<string>()`).
 *
 * The fix routes collection literals in definitions through `valueRef(() =>
 * <factory>)` semantics: each instance gets a fresh `ValueSet`/`ValueMap`/
 * `ValueArray`, cleaned up on parent destroy.
 */
describe('collections inside scope definitions are per-instance', () => {
	it('valueSet field is independent across instances', () => {
		const person = valueScope({
			firstName: value<string>(),
			hobbies: valueSet<string>(),
		});
		const alice = person.create({ firstName: 'Alice' });
		const bob = person.create({ firstName: 'Bob' });

		expect((alice as any).hobbies).not.toBe((bob as any).hobbies);

		(alice as any).hobbies.add('climbing');
		expect([...((alice as any).hobbies.get() as Set<string>)]).toEqual([
			'climbing',
		]);
		expect([...((bob as any).hobbies.get() as Set<string>)]).toEqual([]);
	});

	it('valueArray field is independent across instances', () => {
		const list = valueScope({
			items: valueArray<string>(),
		});
		const a = list.create();
		const b = list.create();
		expect((a as any).items).not.toBe((b as any).items);

		(a as any).items.push('x');
		expect((a as any).items.get()).toEqual(['x']);
		expect((b as any).items.get()).toEqual([]);
	});

	it('valueMap field is independent across instances', () => {
		const store = valueScope({
			scores: valueMap<string, number>(),
		});
		const a = store.create();
		const b = store.create();
		expect((a as any).scores).not.toBe((b as any).scores);

		(a as any).scores.set((draft: Map<string, number>) =>
			draft.set('alice', 95),
		);
		expect((a as any).scores.get('alice')).toBe(95);
		expect((b as any).scores.has('alice')).toBe(false);
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

/**
 * Bug: factory pipes (`pipeDebounce`, `pipeThrottle`, `pipeBatch`)
 * worked when applied to a standalone `value(...).pipe(pipeXxx())`, but were
 * silently dead inside scope slot definitions.
 *
 * Cause: `InstanceStore.activateFactoryPipes(slot)` existed but was never
 * called during scope creation. `InstanceStore.write` only routed through
 * `#factoryPipes.get(slot)` when populated, and `#applySyncPipeline` stopped
 * at the first factory step — so a `value('').pipe(pipeDebounce(300))` field
 * skipped the debounce entirely and fired immediately on every set.
 *
 * Fix: activate factory pipes during InstanceStore construction for every
 * slot whose pipeline contains a factory step. Then re-route the initial
 * value through the pipeline so the initial state stays consistent with
 * standalone Value semantics.
 */
describe('factory pipes inside scope slots', () => {
	it('pipeDebounce inside a scope slot actually debounces writes', () => {
		vi.useFakeTimers();
		const scope = valueScope({
			text: value<string>('').pipe(pipeDebounce(300)),
		});
		const instance = scope.create();

		const subscriber = vi.fn();
		instance.text.subscribe(subscriber);

		instance.text.set('a');
		instance.text.set('ab');
		instance.text.set('abc');

		// Before the debounce expires, nothing should be observable.
		expect(subscriber).not.toHaveBeenCalled();
		expect(instance.text.get()).toBe('');

		vi.advanceTimersByTime(300);
		expect(subscriber).toHaveBeenCalledOnce();
		expect(instance.text.get()).toBe('abc');

		vi.useRealTimers();
	});

	it('factory pipe cleanups run on $destroy', () => {
		vi.useFakeTimers();
		const scope = valueScope({
			text: value<string>('').pipe(pipeDebounce(300)),
		});
		const instance = scope.create();
		const subscriber = vi.fn();
		instance.text.subscribe(subscriber);

		instance.text.set('queued');
		// Destroy while the debounce timer is pending — the pipe's onCleanup
		// must clear it so the deferred write doesn't fire after destroy.
		instance.$destroy();

		vi.advanceTimersByTime(500);
		expect(subscriber).not.toHaveBeenCalled();
		expect(instance.text.get()).toBe('');

		vi.useRealTimers();
	});

	/**
	 * Bug: `pipeBatch` schedules a `Promise.resolve().then(...)` and has no
	 * `onCleanup` registered, so a `$destroy()` between the `.set(...)` and
	 * the microtask fires the deferred write *after* the instance is dead.
	 * The write goes through the factory's `set` callback into
	 * `InstanceStore._writeToSignal`, which had no `destroyed` guard, so the
	 * disposed slot's signal still got mutated. Any consumer that had
	 * subscribed to the signal via a path other than the instance's own
	 * disposers (a `valueRef` from another scope, for instance) would see
	 * the leaked update.
	 *
	 * Fix lives in `InstanceStore._writeToSignal`: short-circuit when the
	 * store has been destroyed. Generalizes to *any* factory pipe that
	 * defers without an onCleanup.
	 */
	/**
	 * Bug: when a scope field is declared as `value(5).pipe(x => x*2).pipe(<factory>)`,
	 * the slot's `defaultValue` is captured from the chained Value's signal
	 * — which is already post-pipe (so 10). `InstanceStore`'s constructor
	 * then ran `#applySyncPipeline(initial, pipeline)` against that default,
	 * re-applying every sync step a second time (so 20). Combined with the
	 * standalone `Value.pipe(factory)` bug it ran sync three times.
	 *
	 * Fix: only run `#applySyncPipeline` when the initial value came from
	 * the user's `.create({...})` input. The Value-derived default has
	 * already been through every sync step at definition time; we just
	 * route it directly into the slot's signal and the activated factory.
	 */
	it('sync pipe followed by a factory inside a scope: default applies sync only once', () => {
		const scope = valueScope({
			x: value(5)
				.pipe((x: number) => x * 2)
				.pipe(pipeBatch()),
		});
		const inst = scope.create();
		// 5 doubled once = 10. Batch is a pass-through; the default must
		// be 10, not 20 (double-applied) or 40 (triple).
		expect(inst.x.get()).toBe(10);
	});

	it('create() input still flows through the sync pipeline', () => {
		const scope = valueScope({
			x: value(0).pipe((x: number) => x * 2),
		});
		const inst = scope.create({ x: 7 });
		// User-supplied input goes through pipes exactly once.
		expect(inst.x.get()).toBe(14);
	});

	it('pipeBatch microtask scheduled before $destroy does not leak a write into the slot', async () => {
		const scope = valueScope({
			text: value<string>('').pipe(pipeBatch()),
		});
		const instance = scope.create();

		instance.text.set('queued');
		// Batched — not yet written through.
		expect(instance.text.get()).toBe('');

		instance.$destroy();

		// Drain microtasks. Without the guard, pipeBatch's deferred `set`
		// flushes through `_writeToSignal` and mutates the slot's signal.
		await Promise.resolve();
		await Promise.resolve();

		expect(instance.text.get()).toBe('');
	});
});

/**
 * Bug: factory ref destruction only propagated to objects that had
 * `$destroy` (scope instances and ScopeMaps). Factory refs to plain reactive
 * primitives (`Value`, `ValueSet`, `ValueMap`, `ValueArray`) silently leaked
 * their subscriptions when the parent was destroyed — those classes expose
 * `.destroy()`, not `$destroy`.
 */
describe('factory refs to non-scope reactive primitives', () => {
	it('factory ref to a Value gets disposed when parent is destroyed', () => {
		const parent = valueScope({
			counter: valueRef(() => value(0)),
		});

		const instance = parent.create();
		const counter = (instance as any).counter as Value<number>;
		const subscriber = vi.fn();
		counter.subscribe(subscriber);

		instance.$destroy();

		// After destroy, the Value's subscribers should be torn down; setting
		// after destroy is allowed by Value semantics but must not notify.
		counter.set(5);
		expect(subscriber).not.toHaveBeenCalled();
	});
});
