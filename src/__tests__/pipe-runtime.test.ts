import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildPipeChain,
	type PipeFactoryDescriptor,
	type RuntimePipeStep,
} from '../core/utils/pipe-runtime.js';

const sync = (transform: (value: unknown) => unknown): RuntimePipeStep => ({
	kind: 'sync',
	transform,
});
const factory = (
	descriptor: PipeFactoryDescriptor<unknown, unknown>,
): RuntimePipeStep => ({ kind: 'factory', descriptor });

describe('buildPipeChain', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('reports no actors for a sync-only step list', () => {
		const chain = buildPipeChain([sync((v) => v)], () => {});
		expect(chain.hasActors).toBe(false);
	});

	it('a synchronous actor commits during write()', () => {
		const committed: unknown[] = [];
		const passthrough: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => ({ onWrite: (value) => host.set(value) }),
		};
		const chain = buildPipeChain([factory(passthrough)], (v) =>
			committed.push(v),
		);
		chain.write('a');
		expect(committed).toEqual(['a']); // synchronous
	});

	it('applies leading and trailing sync steps around an actor', () => {
		const committed: unknown[] = [];
		const passthrough: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => ({ onWrite: (value) => host.set(value) }),
		};
		const chain = buildPipeChain(
			[
				sync((v) => `${v as string}-lead`),
				factory(passthrough),
				sync((v) => `${v as string}-trail`),
			],
			(v) => committed.push(v),
		);
		chain.write('x');
		expect(committed).toEqual(['x-lead-trail']);
	});

	it('a deferring actor commits after its deferBy resolves', async () => {
		const committed: unknown[] = [];
		const delay: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => ({
				onWrite(value) {
					void host.deferBy(100).then(() => host.set(value));
				},
			}),
		};
		const chain = buildPipeChain([factory(delay)], (v) => committed.push(v));
		chain.write('a');
		expect(committed).toEqual([]);
		await vi.advanceTimersByTimeAsync(100);
		expect(committed).toEqual(['a']);
	});

	it('flush() expedites a deferring actor and resolves when committed', async () => {
		const committed: unknown[] = [];
		const delay: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => ({
				onWrite(value) {
					void host.deferBy(10_000).then(() => host.set(value));
				},
			}),
		};
		const chain = buildPipeChain([factory(delay)], (v) => committed.push(v));
		chain.write('a');
		await chain.flush();
		expect(committed).toEqual(['a']);
	});

	it('flush() cascades through a chain of two deferring actors', async () => {
		const committed: string[] = [];
		const label = (tag: string): PipeFactoryDescriptor<unknown, unknown> => ({
			create: (host) => ({
				onWrite(value) {
					void host
						.deferBy(10_000)
						.then(() => host.set(`${tag}:${value as string}`));
				},
			}),
		});
		const chain = buildPipeChain(
			[factory(label('A')), factory(label('B'))],
			(v) => committed.push(v as string),
		);
		chain.write('x');
		await chain.flush();
		expect(committed).toEqual(['B:A:x']);
	});

	it('flush() resolves immediately when nothing is in flight', async () => {
		const passthrough: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => ({ onWrite: (value) => host.set(value) }),
		};
		const chain = buildPipeChain([factory(passthrough)], () => {});
		chain.write('a'); // commits synchronously, nothing pending
		await expect(chain.flush()).resolves.toBeUndefined();
	});

	it('accumulating actor survives multiple writes (no auto-abort)', async () => {
		const committed: number[][] = [];
		const batch: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => {
				let buffer: number[] = [];
				let scheduled = false;
				return {
					onWrite(value) {
						buffer.push(value as number);
						if (scheduled) return;
						scheduled = true;
						void host.deferBy(0).then(() => {
							scheduled = false;
							host.set(buffer);
							buffer = [];
						});
					},
				};
			},
		};
		const chain = buildPipeChain([factory(batch)], (v) =>
			committed.push(v as number[]),
		);
		chain.write(1);
		chain.write(2);
		chain.write(3);
		await vi.advanceTimersByTimeAsync(0);
		expect(committed).toEqual([[1, 2, 3]]);
	});

	it('destroy() aborts host.signal and runs onCleanup', () => {
		const cleanup = vi.fn();
		const aborted = vi.fn();
		const descriptor: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => {
				host.onCleanup(cleanup);
				host.signal.addEventListener('abort', aborted);
				return { onWrite: (value) => host.set(value) };
			},
		};
		const chain = buildPipeChain([factory(descriptor)], () => {});
		chain.write('a');
		chain.destroy();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(aborted).toHaveBeenCalledTimes(1);
	});

	it('an actor may override pendingPromise for work the host cannot see', async () => {
		const committed: string[] = [];
		let resolveFetch: ((value: string) => void) | undefined;
		const fetchPipe: PipeFactoryDescriptor<unknown, unknown> = {
			create: (host) => {
				let pending: Promise<void> | null = null;
				return {
					onWrite(value) {
						pending = new Promise<string>((resolve) => {
							resolveFetch = resolve;
						}).then((result) => {
							host.set(`${value as string}:${result}`);
							pending = null;
						});
					},
					get pendingPromise() {
						return pending;
					},
				};
			},
		};
		const chain = buildPipeChain([factory(fetchPipe)], (v) =>
			committed.push(v as string),
		);
		chain.write('q');
		const flushPromise = chain.flush();
		expect(committed).toEqual([]);
		resolveFetch!('done');
		await flushPromise;
		expect(committed).toEqual(['q:done']);
	});
});
