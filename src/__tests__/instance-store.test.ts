import { describe, it, expect, vi } from 'vitest';
import { InstanceStore } from '../core/instance-store.js';
import type {
	ScopeDefinitionMeta,
	SlotMeta,
	GroupMeta,
} from '../core/slot-meta.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeSlotMeta(overrides: Partial<SlotMeta> = {}): SlotMeta {
	return {
		path: 'field',
		fieldName: 'field',
		kind: 'value',
		pipeline: null,
		comparator: null,
		defaultValue: undefined,
		ancestorGroupIndices: [],
		derivationFn: null,
		schema: null,
		readonly: false,
		...overrides,
	};
}

function makeRootGroup(childSlots: number[]): GroupMeta {
	return {
		path: '',
		fieldName: '',
		index: 0,
		ancestorGroupIndices: [],
		childSlots,
		childGroups: [],
	};
}

function makeDefinition(
	slots: SlotMeta[],
	groups?: GroupMeta[],
): ScopeDefinitionMeta {
	return {
		slotCount: slots.length,
		slots,
		groups: groups ?? [makeRootGroup(slots.map((_, i) => i))],
		staticEntries: new Map(),
		pathToSlot: new Map(slots.map((s, i) => [s.path, i])),
		pathToGroup: new Map(),
		refEntries: new Map(),
	};
}

describe('InstanceStore', () => {
	describe('read / write', () => {
		it('reads the initial value', () => {
			const definition = makeDefinition([
				makeSlotMeta({ path: 'name', defaultValue: 'Alice' }),
			]);
			const store = new InstanceStore(definition, new Map());
			expect(store.read(0)).toBe('Alice');
		});

		it('reads from initialValues over default', () => {
			const definition = makeDefinition([
				makeSlotMeta({ path: 'name', defaultValue: 'Alice' }),
			]);
			const store = new InstanceStore(definition, new Map([[0, 'Bob']]));
			expect(store.read(0)).toBe('Bob');
		});

		it('writes and reads back', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));
			store.write(0, 'Bob');
			expect(store.read(0)).toBe('Bob');
		});
	});

	describe('pipeline', () => {
		it('applies sync pipeline on write', () => {
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'name',
					pipeline: [
						{ kind: 'sync', transform: (v) => (v as string).trim() },
						{ kind: 'sync', transform: (v) => (v as string).toLowerCase() },
					],
				}),
			]);
			const store = new InstanceStore(definition, new Map([[0, '']]));
			store.write(0, '  HELLO  ');
			expect(store.read(0)).toBe('hello');
		});

		it('applies sync pipeline to initial value', () => {
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'name',
					defaultValue: '  HELLO  ',
					pipeline: [{ kind: 'sync', transform: (v) => (v as string).trim() }],
				}),
			]);
			const store = new InstanceStore(definition, new Map());
			expect(store.read(0)).toBe('HELLO');
		});
	});

	describe('comparator', () => {
		it('skips write when comparator returns true', () => {
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'user',
					comparator: (a, b) =>
						(a as { id: number }).id === (b as { id: number }).id,
				}),
			]);
			const store = new InstanceStore(
				definition,
				new Map([[0, { id: 1, name: 'Alice' }]]),
			);
			const originalRef = store.read(0);
			store.write(0, { id: 1, name: 'Bob' });
			expect(store.read(0)).toBe(originalRef); // same reference, not updated
		});

		it('allows write when comparator returns false', () => {
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'user',
					comparator: (a, b) =>
						(a as { id: number }).id === (b as { id: number }).id,
				}),
			]);
			const store = new InstanceStore(
				definition,
				new Map([[0, { id: 1, name: 'Alice' }]]),
			);
			store.write(0, { id: 2, name: 'Bob' });
			expect((store.read(0) as { id: number }).id).toBe(2);
		});
	});

	describe('subscribe', () => {
		it('fires on write with value and previous', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));
			const calls: [unknown, unknown][] = [];
			store.subscribe(0, (value, previous) => calls.push([value, previous]));
			store.write(0, 'Bob');
			expect(calls).toEqual([['Bob', 'Alice']]);
		});

		it('returns unsubscribe function', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));
			const calls: unknown[] = [];
			const unsub = store.subscribe(0, (value) => calls.push(value));
			unsub();
			store.write(0, 'Bob');
			expect(calls).toHaveLength(0);
		});
	});

	describe('onChange batching', () => {
		it('batches multiple writes into one onChange call', async () => {
			const definition = makeDefinition([
				makeSlotMeta({ path: 'firstName' }),
				makeSlotMeta({ path: 'lastName' }),
			]);
			const store = new InstanceStore(
				definition,
				new Map([
					[0, 'Alice'],
					[1, 'Smith'],
				]),
			);

			const root = {};
			const firstNameNode = {};
			const lastNameNode = {};
			store.registerTree(
				root,
				new Map([
					[0, firstNameNode],
					[1, lastNameNode],
				]),
				new Map(),
			);

			const onChangeCalls: { paths: string[] }[] = [];
			store.onChangeHook = ({ changes }) => {
				onChangeCalls.push({
					paths: [...changes].map((c) => c.path),
				});
			};

			store.write(0, 'Bob');
			store.write(1, 'Jones');

			// Not yet fired (microtask)
			expect(onChangeCalls).toHaveLength(0);

			await flush();

			expect(onChangeCalls).toHaveLength(1);
			expect(onChangeCalls[0]!.paths).toContain('firstName');
			expect(onChangeCalls[0]!.paths).toContain('lastName');
		});
	});

	describe('beforeChange', () => {
		it('prevents a write when prevent() is called with the scope node', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const root = {};
			const nameNode = {};
			store.registerTree(root, new Map([[0, nameNode]]), new Map());

			store.beforeChangeHook = ({ prevent }) => {
				prevent(nameNode);
			};

			store.write(0, 'Bob');
			expect(store.read(0)).toBe('Alice'); // prevented
		});

		it('prevents a write when prevent() is called with the change object', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const root = {};
			const nameNode = {};
			store.registerTree(root, new Map([[0, nameNode]]), new Map());

			store.beforeChangeHook = ({ changes, prevent }) => {
				for (const change of changes) {
					if (change.to === 'Bob') prevent(change);
				}
			};

			store.write(0, 'Bob');
			expect(store.read(0)).toBe('Alice'); // prevented

			store.write(0, 'Charlie');
			expect(store.read(0)).toBe('Charlie'); // allowed
		});
	});

	describe('changesByScope bubbling', () => {
		it('bubbles changes to ancestor groups', async () => {
			const jobTitleSlot = makeSlotMeta({
				path: 'job.title',
				ancestorGroupIndices: [1], // group index 1 = job group
			});
			const jobCompanySlot = makeSlotMeta({
				path: 'job.company',
				ancestorGroupIndices: [1],
			});
			const jobGroup: GroupMeta = {
				path: 'job',
				fieldName: 'job',
				index: 1,
				ancestorGroupIndices: [],
				childSlots: [0, 1],
				childGroups: [],
			};

			const definition = makeDefinition(
				[jobTitleSlot, jobCompanySlot],
				[makeRootGroup([]), jobGroup],
			);
			const store = new InstanceStore(
				definition,
				new Map([
					[0, 'Engineer'],
					[1, 'Acme'],
				]),
			);

			const root = {};
			const titleNode = {};
			const companyNode = {};
			const jobNode = {};
			store.registerTree(
				root,
				new Map([
					[0, titleNode],
					[1, companyNode],
				]),
				new Map([[1, jobNode]]),
			);

			let capturedChangesByScope: Map<object, unknown[]> | null = null;
			store.onChangeHook = ({ changesByScope }) => {
				capturedChangesByScope = changesByScope;
			};

			store.write(0, 'CTO');
			await flush();

			expect(capturedChangesByScope).not.toBeNull();
			// Change should appear under the title node
			expect(capturedChangesByScope!.has(titleNode)).toBe(true);
			// And bubble up to the job group
			expect(capturedChangesByScope!.has(jobNode)).toBe(true);
			// And bubble to root
			expect(capturedChangesByScope!.has(root)).toBe(true);
		});
	});

	describe('beforeChange prevent-all', () => {
		it('prevents all changes when prevent() is called with no argument', () => {
			const definition = makeDefinition([
				makeSlotMeta({ path: 'firstName' }),
				makeSlotMeta({ path: 'lastName' }),
			]);
			const store = new InstanceStore(
				definition,
				new Map([
					[0, 'Alice'],
					[1, 'Smith'],
				]),
			);

			const root = {};
			const firstNode = {};
			const lastNode = {};
			store.registerTree(
				root,
				new Map([
					[0, firstNode],
					[1, lastNode],
				]),
				new Map(),
			);

			store.beforeChangeHook = ({ prevent }) => {
				prevent();
			};

			store.write(0, 'Bob');
			expect(store.read(0)).toBe('Alice');
		});

		it('prevents via ancestor group node', () => {
			const jobTitleSlot = makeSlotMeta({
				path: 'job.title',
				ancestorGroupIndices: [1],
			});
			const jobGroup: GroupMeta = {
				path: 'job',
				fieldName: 'job',
				index: 1,
				ancestorGroupIndices: [],
				childSlots: [0],
				childGroups: [],
			};

			const definition = makeDefinition(
				[jobTitleSlot],
				[makeRootGroup([]), jobGroup],
			);
			const store = new InstanceStore(definition, new Map([[0, 'Engineer']]));

			const root = {};
			const titleNode = {};
			const jobNode = {};
			store.registerTree(
				root,
				new Map([[0, titleNode]]),
				new Map([[1, jobNode]]),
			);

			store.beforeChangeHook = ({ prevent }) => {
				prevent(jobNode);
			};

			store.write(0, 'CTO');
			expect(store.read(0)).toBe('Engineer');
		});
	});

	describe('factory pipes', () => {
		it('activates factory pipes and routes writes through them', () => {
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'search',
					pipeline: [
						{
							kind: 'factory',
							descriptor: {
								create: ({ set }) => {
									return (value: unknown) => {
										// Immediately pass through (no delay)
										set(value);
									};
								},
							},
						},
					],
				}),
			]);
			const store = new InstanceStore(definition, new Map([[0, '']]));
			store.activateFactoryPipes(0);

			store.write(0, 'hello');
			expect(store.read(0)).toBe('hello');
		});

		it('factory pipe cleanup runs on destroy', () => {
			const cleanup = vi.fn();
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'search',
					pipeline: [
						{
							kind: 'factory',
							descriptor: {
								create: ({ set, onCleanup }) => {
									onCleanup(cleanup);
									return (value: unknown) => set(value);
								},
							},
						},
					],
				}),
			]);
			const store = new InstanceStore(definition, new Map([[0, '']]));
			store.activateFactoryPipes(0);

			expect(cleanup).not.toHaveBeenCalled();
			store.destroy();
			expect(cleanup).toHaveBeenCalledOnce();
		});

		it('factory pipe with sync steps before and after', () => {
			const definition = makeDefinition([
				makeSlotMeta({
					path: 'value',
					pipeline: [
						{ kind: 'sync', transform: (v) => (v as string).trim() },
						{
							kind: 'factory',
							descriptor: {
								create: ({ set }) => {
									return (value: unknown) => set(value);
								},
							},
						},
						{
							kind: 'sync',
							transform: (v) => (v as string).toUpperCase(),
						},
					],
				}),
			]);
			const store = new InstanceStore(definition, new Map([[0, '']]));
			store.activateFactoryPipes(0);

			store.write(0, '  hello  ');
			expect(store.read(0)).toBe('HELLO');
		});
	});

	describe('subscribeValidation', () => {
		it('fires on validation state changes for schema slots', () => {
			// Minimal Standard Schema that always passes
			const passSchema = {
				'~standard': {
					version: 1 as const,
					vendor: 'test',
					validate: (value: unknown) => ({ value }),
				},
			};
			const definition = makeDefinition([
				makeSlotMeta({ path: 'email', kind: 'schema', schema: passSchema }),
			]);
			const store = new InstanceStore(definition, new Map([[0, 'test']]));

			const calls: unknown[] = [];
			store.subscribeValidation(0, () => calls.push('changed'));

			// Trigger a validation state change by writing to the validation signal
			const validationSignal = store.validationStates.get(0);
			expect(validationSignal).toBeDefined();
			validationSignal!.value = {
				isValid: false,
				value: 'test',
				issues: [{ message: 'invalid' }],
			};

			expect(calls).toEqual(['changed']);
		});

		it('returns noop for non-schema slots', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const unsub = store.subscribeValidation(0, () => {});
			expect(typeof unsub).toBe('function');
			unsub(); // should not throw
		});
	});

	describe('subscribeAsyncState', () => {
		it('fires on async state changes', () => {
			const definition = makeDefinition([
				makeSlotMeta({ path: 'data', kind: 'asyncDerived' }),
			]);
			const store = new InstanceStore(definition, new Map());

			const calls: unknown[] = [];
			store.subscribeAsyncState(0, () => calls.push('changed'));

			const asyncSignal = store.asyncStates.get(0);
			if (asyncSignal) {
				asyncSignal.value = {
					status: 'set',
					value: 'result',
					hasValue: true,
					error: undefined,
				};
			}

			expect(calls).toEqual(['changed']);
		});

		it('returns noop for non-async slots', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const unsub = store.subscribeAsyncState(0, () => {});
			expect(typeof unsub).toBe('function');
			unsub(); // should not throw
		});
	});

	describe('subscriber tracking', () => {
		it('fires onUsedHook on first subscriber', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const onUsed = vi.fn();
			store.onUsedHook = onUsed;

			const unsub = store.subscribe(0, () => {});
			expect(onUsed).toHaveBeenCalledOnce();
			unsub();
		});

		it('fires onUnusedHook when last subscriber leaves', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const onUnused = vi.fn();
			store.onUnusedHook = onUnused;

			const unsub = store.subscribe(0, () => {});
			expect(onUnused).not.toHaveBeenCalled();
			unsub();
			expect(onUnused).toHaveBeenCalledOnce();
		});

		it('trackExternalSubscription participates in counting', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const onUsed = vi.fn();
			const onUnused = vi.fn();
			store.onUsedHook = onUsed;
			store.onUnusedHook = onUnused;

			const unsub = store.trackExternalSubscription();
			expect(onUsed).toHaveBeenCalledOnce();

			unsub();
			expect(onUnused).toHaveBeenCalledOnce();
		});

		it('trackExternalSubscription dispose is idempotent', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));

			const onUnused = vi.fn();
			store.onUnusedHook = onUnused;

			const unsub = store.trackExternalSubscription();
			unsub();
			unsub();
			expect(onUnused).toHaveBeenCalledOnce();
		});
	});

	describe('destroy', () => {
		it('marks the instance as destroyed', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));
			expect(store.destroyed).toBe(false);
			store.destroy();
			expect(store.destroyed).toBe(true);
		});

		it('ignores writes after destroy', () => {
			const definition = makeDefinition([makeSlotMeta({ path: 'name' })]);
			const store = new InstanceStore(definition, new Map([[0, 'Alice']]));
			store.destroy();
			store.write(0, 'Bob');
			expect(store.read(0)).toBe('Alice');
		});
	});
});
