/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createDeferral, type Deferral } from './deferral.js';
import type { PipeFactoryDescriptor, PipeHost } from '../types.js';

/**
 * Actor-model pipe runtime. Both standalone `Value` and scope-instance
 * fields build their factory-pipe chains through `buildPipeChain`, so the
 * actor lifecycle (host, deferrals, cascade flush, teardown) lives in one
 * place. See `docs/pipes.md`.
 *
 * @internal
 */

/** Minimal step shape shared by `Value` and scope-instance pipelines. */
export type RuntimePipeStep =
	| { kind: 'sync'; transform: (value: unknown) => unknown }
	| { kind: 'factory'; descriptor: PipeFactoryDescriptor<unknown, unknown> };

/** A wired factory-pipe chain. */
export interface PipeChain {
	/** Push a raw value in. Leading sync steps are applied internally. */
	write(value: unknown): void;
	/**
	 * Seed the chain's first actor with a value, skipping leading sync
	 * steps. Used by `Value.pipe()` to let a freshly-built chain observe
	 * the current value (which already has leading sync applied).
	 */
	prime(value: unknown): void;
	/** Cascade-flush all in-flight actor work; resolves when settled. */
	flush(): Promise<void>;
	/** Abort every host and run cleanups. */
	destroy(): void;
	/** Whether the chain contains any factory actors. */
	readonly hasActors: boolean;
}

interface WiredActor {
	onWrite(value: unknown): void;
	pendingPromise(): Promise<void> | null;
	flush(): void;
	destroy(): void;
}

/**
 * Build an actor chain from an ordered step list and a terminal `commit`.
 * Sync steps before the first factory are applied in `write`; sync steps
 * between factories are applied as each actor commits downstream.
 *
 * @internal
 */
export function buildPipeChain(
	steps: readonly RuntimePipeStep[],
	commit: (value: unknown) => void,
): PipeChain {
	const factoryPositions = steps
		.map((step, index) => (step.kind === 'factory' ? index : -1))
		.filter((index) => index >= 0);

	if (factoryPositions.length === 0) {
		return {
			write() {},
			prime() {},
			flush: () => Promise.resolve(),
			destroy() {},
			hasActors: false,
		};
	}

	const applySync = (from: number, to: number, value: unknown): unknown => {
		let current = value;
		for (let i = from; i < to; i += 1) {
			const step = steps[i]!;
			if (step.kind === 'sync') current = step.transform(current);
		}
		return current;
	};

	const actors: WiredActor[] = [];

	for (const [index, position] of factoryPositions.entries()) {
		const isLast = index === factoryPositions.length - 1;
		const nextPosition = isLast ? steps.length : factoryPositions[index + 1]!;
		const { descriptor } = steps[position] as Extract<
			RuntimePipeStep,
			{ kind: 'factory' }
		>;

		const abortController = new AbortController();
		const deferrals = new Set<Deferral>();
		const cleanups: (() => void)[] = [];

		const host: PipeHost<unknown> = {
			set(value) {
				const transformed = applySync(position + 1, nextPosition, value);
				if (isLast) commit(transformed);
				else actors[index + 1]!.onWrite(transformed);
			},
			onCleanup(fn) {
				cleanups.push(fn);
			},
			signal: abortController.signal,
			deferBy(ms) {
				const deferral = createDeferral(abortController.signal);
				deferrals.add(deferral);
				const promise = deferral.deferBy(ms);
				const remove = (): void => {
					deferrals.delete(deferral);
				};
				promise.then(remove, remove);
				return promise;
			},
		};

		const actor = descriptor.create(host);

		const hostPending = (): Promise<void> | null => {
			const active = [...deferrals]
				.map((deferral) => deferral.pending)
				.filter((promise): promise is Promise<void> => promise !== null);
			return active.length > 0 ?
					Promise.all(active).then(() => undefined)
				:	null;
		};

		actors.push({
			onWrite: (value) => {
				actor.onWrite(value);
			},
			pendingPromise: () =>
				actor.pendingPromise !== undefined ?
					actor.pendingPromise
				:	hostPending(),
			flush: () => {
				if (actor.flush) actor.flush();
				else for (const deferral of deferrals) deferral.flush();
			},
			destroy: () => {
				abortController.abort();
				for (const cleanup of cleanups) cleanup();
				cleanups.length = 0;
			},
		});
	}

	return {
		write(raw) {
			const value = applySync(0, factoryPositions[0]!, raw);
			actors[0]!.onWrite(value);
		},
		prime(value) {
			actors[0]!.onWrite(value);
		},
		async flush() {
			// Chase in-flight actor work until a full scan, plus one
			// microtask, surfaces nothing new. Flushing an actor resolves
			// its deferral; the actor's own continuation then calls
			// host.set() downstream, which may start the next actor's work.
			for (;;) {
				const pendings: Promise<void>[] = [];
				for (const actor of actors) {
					if (actor.pendingPromise() !== null) {
						actor.flush();
						const after = actor.pendingPromise();
						if (after) pendings.push(after);
					}
				}
				if (pendings.length === 0) {
					await Promise.resolve();
					if (actors.every((actor) => actor.pendingPromise() === null)) {
						return;
					}
					continue;
				}
				await Promise.all(pendings);
				await Promise.resolve();
			}
		},
		destroy() {
			for (const actor of actors) actor.destroy();
		},
		hasActors: true,
	};
}
