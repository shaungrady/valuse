/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { computed, type ReadonlySignal } from './signal.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';
import { subscribeFireOnly } from './utils/effect-helpers.js';
import {
	setNestedValue,
	buildSnapshot,
	setSnapshotValues,
} from './scope-snapshot.js';
import { fireOnCreate } from './scope-lifecycle.js';
import type { InstanceStore } from './instance-store.js';
import type { ScopeConfig } from './scope-config.js';
import type { ScopeDefinitionMeta } from './slot-meta.js';
import type { GenericScopeInstance } from './scope-types.js';
import type { Unsubscribe } from './types.js';

/**
 * Cache of the per-template `$flush()` layer grouping, keyed by the shared
 * definition. A definition is built fresh per template and always paired with
 * the same `layers`, so the grouping is stable across all instances.
 */
const layerSlotsCache = new WeakMap<ScopeDefinitionMeta, number[][]>();

/**
 * Group slot indices by the declared layer they flush in. Each top-level key
 * maps to the last layer it appears in; slots inherit their top-level path
 * segment's layer (defaulting to the field layer). With no layer info,
 * everything flushes as one group. Memoized per definition. @internal
 */
function getLayerSlots(
	definition: ScopeDefinitionMeta,
	layers: ReadonlyArray<Record<string, unknown>>,
): number[][] {
	const cached = layerSlotsCache.get(definition);
	if (cached) return cached;

	const segmentLayer = new Map<string, number>();
	for (const [index, layer] of layers.entries()) {
		for (const [key, entry] of Object.entries(layer)) {
			if (entry !== undefined) segmentLayer.set(key, index);
		}
	}
	const layerSlots: number[][] =
		layers.length > 0 ? layers.map(() => []) : [[]];
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const segment = definition.slots[slot]!.path.split('.')[0]!;
		const layerIndex = segmentLayer.get(segment) ?? 0;
		layerSlots[layerIndex]!.push(slot);
	}

	layerSlotsCache.set(definition, layerSlots);
	return layerSlots;
}

/** Attach $-prefixed instance methods. @internal */
export function attachDollarMethods(
	instance: Record<string, unknown>,
	store: InstanceStore,
	definition: ScopeDefinitionMeta,
	config: ScopeConfig | undefined,
	instanceCleanups: (() => void)[],
	lifecycleCleanups: (() => void)[],
	undeclaredProperties?: Map<string, unknown>,
	factoryRefInstances?: Record<string, unknown>[],
	factoryRefDestroyables?: { destroy: () => void }[],
	layers: ReadonlyArray<Record<string, unknown>> = [],
): void {
	// Register a Preact dependency on every slot signal. Used by the snapshot
	// invalidator, `$subscribe`, and `instance._trackAll` (the derivation-scope
	// ref hook). Coarse-grained by design.
	const trackAllSlots = (): void => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			void store.signals[slot]!.value;
		}
	};

	// Group slots by declared layer for the `$flush()` cascade. The grouping
	// depends only on the (static) definition and layers, both fixed per
	// template, so it is identical for every instance — memoize it per
	// definition instead of recomputing (and re-splitting every slot path)
	// on each `create()`.
	const layerSlots = getLayerSlots(definition, layers);

	instance.$destroy = () => {
		// Idempotency: a second call must be a no-op so onDestroy fires once
		// and factory-ref children aren't re-destroyed. Naturally exercised
		// when ScopeMap.delete (which calls $destroy internally) and a
		// caller-held reference both reach for $destroy.
		if (store.destroyed) return;

		// Run lifecycle disposers first (aborts the onCreate signal so user
		// cleanups see a consistent torn-down state), then instance-level
		// disposers (derivation effects, validation, snapshot tracking).
		for (const cleanup of lifecycleCleanups) cleanup();
		lifecycleCleanups.length = 0;
		for (const cleanup of instanceCleanups) cleanup();
		instanceCleanups.length = 0;

		// Propagate $destroy to factory-created scope refs.
		if (factoryRefInstances) {
			for (const refInstance of factoryRefInstances) {
				if (typeof refInstance.$destroy === 'function') {
					(refInstance.$destroy as () => void)();
				}
			}
		}

		// Tear down factory-created reactive primitives (Value / ValueSet /
		// ValueMap / ValueArray) — they expose `.destroy()` rather than
		// `$destroy`. Without this they leaked subscribers on parent destroy.
		if (factoryRefDestroyables) {
			for (const ref of factoryRefDestroyables) {
				ref.destroy();
			}
		}

		// Fire onDestroy
		if (config?.onDestroy) {
			config.onDestroy({ scope: instance as GenericScopeInstance });
		}

		store.destroy();
	};

	// Memoized snapshot: a lazy computed rebuilt only when read after a tracked
	// signal changed. `$use` returns this same reference across renders when
	// nothing has changed, so React downstream can rely on Object.is equality.
	// We also track `store._plainVersion` (when the scope has plain fields) so
	// plain writes invalidate the cache without dirtying the per-slot signal
	// graph that `$subscribe`/derivations observe.
	//
	// The `computed` itself is built on first read, not at create() time: a
	// scope that's only written (never snapshotted via `$getSnapshot`/`$use`)
	// pays nothing for it. An unobserved computed is version-cached, so repeated
	// reads without an intervening change return the prior object reference.
	let snapshotComputed: ReadonlySignal<Record<string, unknown>> | null = null;

	function getMemoizedSnapshot(): Record<string, unknown> {
		snapshotComputed ??= computed(() => {
			if (store._plainVersion) void store._plainVersion.value;
			return buildSnapshot(definition, store, true);
		});
		return snapshotComputed.peek();
	}

	instance.$getSnapshot = () => {
		const snapshot = getMemoizedSnapshot();
		if (undeclaredProperties && undeclaredProperties.size > 0) {
			const result = { ...snapshot };
			for (const [path, value] of undeclaredProperties) {
				setNestedValue(result, path, value);
			}
			return result;
		}
		return snapshot;
	};

	instance.$setSnapshot = (
		data: Record<string, unknown>,
		options?: { recreate?: boolean },
	) => {
		// Non-object input (null, undefined, primitives) has no fields to apply.
		// Warn and skip so a stray value can't crash hydration with a cryptic
		// native "Cannot convert undefined or null to object" — and so the
		// behavior is consistent across all non-conforming inputs. The declared
		// type is always an object, but runtime callers (casts, parsed JSON,
		// hydration) can pass anything, so we narrow through `unknown`.
		const raw = data as unknown;
		if (typeof raw !== 'object' || raw === null) {
			console.warn(
				`valuse: $setSnapshot expected a plain object, received ${raw === null ? 'null' : typeof raw}. Skipping.`,
			);
			return;
		}
		setSnapshotValues(definition, store, data, '');

		if (options?.recreate) {
			// Recreate models a fresh onDestroy → onCreate cycle. Only touch
			// lifecycle disposers; per-instance derivation infrastructure
			// (sync effects, async aborts, validation) stays alive so
			// downstream behavior keeps reacting.
			for (const cleanup of lifecycleCleanups) cleanup();
			lifecycleCleanups.length = 0;

			if (config?.onDestroy) {
				config.onDestroy({ scope: instance as GenericScopeInstance });
			}

			fireOnCreate(config, instance, data, lifecycleCleanups);
		}
	};

	instance.$subscribe = (fn: () => void): Unsubscribe => {
		const untrackExternal = store.trackExternalSubscription();
		const dispose = subscribeFireOnly(trackAllSlots, fn);

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			dispose();
			untrackExternal();
		};
	};

	instance.$use = () => {
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(instance, (onChange) => {
				return (instance.$subscribe as (fn: () => void) => () => void)(
					onChange,
				);
			});
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		const snapshot = getMemoizedSnapshot();
		const setter = (data: Record<string, unknown>) => {
			(instance.$setSnapshot as (data: Record<string, unknown>) => void)(data);
		};
		return [snapshot, setter];
	};

	instance.$recompute = () => {
		for (let slot = 0; slot < definition.slotCount; slot++) {
			store.recompute(slot);
		}
	};

	// Expedite all pending deferred work (pipe debounces, async-derivation
	// deferBy) layer by layer in dependency order. Awaiting each layer
	// before the next lets a downstream layer's re-run (triggered when an
	// upstream value commits) see the resolved upstream value.
	//
	// A single ordered pass isn't always enough: an upstream commit
	// schedules the downstream re-run on a microtask, which can land just
	// after we've flushed that downstream layer. So we repeat the ordered
	// cascade until a pass leaves no async derivation running. Bounded by
	// layer depth (+slack) to avoid spinning on pathological graphs.
	instance.$flush = async (): Promise<void> => {
		const maxPasses = layerSlots.length + 2;
		for (let pass = 0; pass < maxPasses; pass++) {
			for (const slots of layerSlots) {
				await Promise.all(slots.map((slot) => store.flushSlot(slot)));
				// A layer's commits schedule downstream re-runs on a
				// microtask. Drain it so the next layer flushes the re-run
				// (reading this layer's resolved value), not a stale run.
				await Promise.resolve();
			}
			// `runningAsync` is null when the scope has no async derivations —
			// nothing can be running, so one flush pass is enough.
			if (!store.runningAsync || store.runningAsync.size === 0) return;
		}
	};

	instance.$get = () => {
		return buildSnapshot(definition, store);
	};

	// Internal: register a Preact dependency on every slot. Used by the
	// derivation-scope ref wrapper so `scope.<instanceRef>.use()` re-runs
	// the enclosing derivation when any field on the referenced instance
	// changes. Tracks coarsely — all fields, regardless of which the
	// consumer reads from the returned snapshot.
	instance._trackAll = trackAllSlots;
}
