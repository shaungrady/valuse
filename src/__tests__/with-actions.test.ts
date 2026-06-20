import { describe, it, expect } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { withActions } from '../middleware/actions.js';
import { withHistory } from '../middleware/history.js';

describe('withActions runtime', () => {
	it('attaches actions that mutate fields', () => {
		const tpl = withActions(valueScope({ count: value(0) }), {
			increment:
				({ scope }) =>
				(by: number) =>
					scope.count.set(scope.count.get() + by),
		});
		const c = tpl.create();
		c.increment(5);
		expect(c.count.get()).toBe(5);
	});

	it('returns values from actions', () => {
		const tpl = withActions(valueScope({ count: value(2) }), {
			squared:
				({ scope }) =>
				() =>
					scope.count.get() ** 2,
		});
		const c = tpl.create();
		expect(c.squared()).toBe(4);
	});

	it('lets a later layer call an earlier layer at runtime', () => {
		const tpl = withActions(
			valueScope({ count: value(0) }),
			{
				inc:
					({ scope }) =>
					(by: number) =>
						scope.count.set(scope.count.get() + by),
			},
			{
				doubleUp:
					({ scope }) =>
					() =>
						scope.inc(scope.count.get()),
			},
		);
		const c = tpl.create();
		c.inc(3);
		c.doubleUp();
		expect(c.count.get()).toBe(6);
	});

	it('exposes a signal that aborts on $destroy', () => {
		let captured: AbortSignal | undefined;
		const tpl = withActions(valueScope({ x: value(0) }), {
			grab:
				({ signal }) =>
				() => {
					captured = signal;
				},
		});
		const c = tpl.create();
		c.grab();
		expect(captured!.aborted).toBe(false);
		c.$destroy();
		expect(captured!.aborted).toBe(true);
	});

	it('lets async actions bail after destroy via signal', async () => {
		const tpl = withActions(valueScope({ done: value(false) }), {
			run:
				({ scope, signal }) =>
				async () => {
					await Promise.resolve();
					if (signal.aborted) return;
					scope.done.set(true);
				},
		});
		const c = tpl.create();
		const snapshotBefore = c.$getSnapshot();
		const p = c.run();
		c.$destroy();
		await p;
		// the write was skipped because signal aborted
		expect(snapshotBefore.done).toBe(false);
	});

	describe('collision guard', () => {
		it('throws when an action shadows a field', () => {
			const tpl = withActions(valueScope({ count: value(0) }), {
				count: () => () => undefined,
			});
			expect(() => tpl.create()).toThrow(/count/);
		});

		it('throws when an action shadows a $-method', () => {
			const tpl = withActions(valueScope({ x: value(0) }), {
				$getSnapshot: () => () => undefined,
			});
			expect(() => tpl.create()).toThrow(/\$/);
		});

		it('throws on a $-prefixed action name', () => {
			const tpl = withActions(valueScope({ x: value(0) }), {
				$custom: () => () => undefined,
			});
			expect(() => tpl.create()).toThrow(/\$/);
		});

		it('throws on a duplicate name across layers', () => {
			const tpl = withActions(
				valueScope({ x: value(0) }),
				{ a: () => () => undefined },
				{ a: () => () => undefined },
			);
			expect(() => tpl.create()).toThrow(/a/);
		});
	});

	it('composes under withHistory, preserving both surfaces', () => {
		const tpl = withActions(withHistory(valueScope({ count: value(0) })), {
			bump:
				({ scope }) =>
				() =>
					scope.count.set(scope.count.get() + 1),
		});
		const c = tpl.create();
		expect(typeof c.bump).toBe('function');
		expect(typeof c.$undo).toBe('function');
		c.bump();
		expect(c.count.get()).toBe(1);
	});

	it('attaches actions to every ScopeMap entry', () => {
		const tpl = withActions(valueScope({ count: value(0) }), {
			inc:
				({ scope }) =>
				() =>
					scope.count.set(scope.count.get() + 1),
		});
		const map = tpl.createMap();
		map.set(1, { count: 0 });
		map.get(1)!.inc();
		expect(map.get(1)!.count.get()).toBe(1);
	});

	it('removes actions from the instance on $destroy', () => {
		const tpl = withActions(valueScope({ x: value(0) }), {
			noop: () => () => undefined,
		});
		const c = tpl.create();
		expect('noop' in c).toBe(true);
		c.$destroy();
		expect('noop' in c).toBe(false);
	});

	describe('onCleanup', () => {
		it('runs invocation cleanup after a sync action returns', () => {
			const log: string[] = [];
			const tpl = withActions(valueScope({ x: value(0) }), {
				act:
					({ onCleanup }) =>
					() => {
						onCleanup(() => log.push('clean'));
						log.push('body');
					},
			});
			tpl.create().act();
			expect(log).toEqual(['body', 'clean']);
		});

		it('runs invocation cleanup after an async action settles', async () => {
			const log: string[] = [];
			const tpl = withActions(valueScope({ x: value(0) }), {
				act:
					({ onCleanup }) =>
					async () => {
						onCleanup(() => log.push('clean'));
						await Promise.resolve();
						log.push('body-end');
					},
			});
			await tpl.create().act();
			expect(log).toEqual(['body-end', 'clean']);
		});

		it('supports onCleanup registered after an await', async () => {
			const log: string[] = [];
			const tpl = withActions(valueScope({ x: value(0) }), {
				act:
					({ onCleanup }) =>
					async () => {
						await Promise.resolve();
						onCleanup(() => log.push('clean')); // post-await registration
						log.push('body-end');
					},
			});
			await tpl.create().act();
			expect(log).toEqual(['body-end', 'clean']);
		});

		it('runs in-flight invocation cleanup on $destroy, exactly once', async () => {
			const log: string[] = [];
			let release!: () => void;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const tpl = withActions(valueScope({ x: value(0) }), {
				act:
					({ onCleanup }) =>
					async () => {
						onCleanup(() => log.push('clean'));
						await gate;
					},
			});
			const c = tpl.create();
			const p = c.act();
			expect(log).toEqual([]);
			c.$destroy();
			expect(log).toEqual(['clean']); // destroy ran the in-flight cleanup
			release();
			await p;
			expect(log).toEqual(['clean']); // settle did not double-run it
		});

		it('skips a cleanup registered after the instance is destroyed', async () => {
			const log: string[] = [];
			let release!: () => void;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const tpl = withActions(
				valueScope({ x: value(0) }),
				{ helper: () => () => log.push('helper') },
				{
					act:
						({ scope, onCleanup }) =>
						async () => {
							await gate;
							// Registered post-await, after $destroy has run. Must not
							// run (instance torn down) — and must not throw even though
							// it calls a sibling that destroy deleted.
							onCleanup(() => {
								log.push('clean');
								scope.helper();
							});
						},
				},
			);
			const c = tpl.create();
			const p = c.act();
			c.$destroy();
			release();
			await expect(p).resolves.toBeUndefined();
			expect(log).toEqual([]);
		});

		it('scopes cleanups per invocation without accumulating', async () => {
			let cleanups = 0;
			const tpl = withActions(valueScope({ x: value(0) }), {
				act:
					({ onCleanup }) =>
					async () => {
						onCleanup(() => {
							cleanups += 1;
						});
						await Promise.resolve();
					},
			});
			const c = tpl.create();
			await c.act();
			await c.act();
			await c.act();
			expect(cleanups).toBe(3); // one per call, each ran exactly once
		});
	});
});
