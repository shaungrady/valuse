/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { InstanceStore } from './instance-store.js';
import type { ScopeDefinitionMeta } from './slot-meta.js';

/** Set a value at a dot-separated path on a nested object. @internal */
export function setNestedValue(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	// Fast path for top-level fields (the common case): no traversal, and no
	// `split` array allocation. `buildSnapshot` calls this once per slot on
	// every (cache-missed) snapshot rebuild, so the flat case is hot.
	if (!path.includes('.')) {
		target[path] = value;
		return;
	}
	const parts = path.split('.');
	let current = target;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]!;
		if (!(part in current) || typeof current[part] !== 'object') {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts.at(-1)!] = value;
}

/**
 * One precomputed assignment for {@link buildSnapshot}. `flatKey` is set for
 * top-level paths (the common case) so the rebuild can assign directly;
 * otherwise `parts` holds the path split once at plan time. `slot >= 0` reads
 * the live value from the store; `slot === -1` is a static entry whose value
 * is captured in `staticValue`.
 */
interface SnapshotStep {
	readonly slot: number;
	readonly staticValue: unknown;
	readonly flatKey: string | null;
	readonly parts: readonly string[] | null;
}

/**
 * Snapshot plans are derived purely from the (static) definition and reused
 * across every instance and every rebuild, so the path parsing happens once.
 */
const snapshotPlanCache = new WeakMap<ScopeDefinitionMeta, SnapshotStep[]>();

function makeStep(
	path: string,
	slot: number,
	staticValue: unknown,
): SnapshotStep {
	if (!path.includes('.')) {
		return { slot, staticValue, flatKey: path, parts: null };
	}
	return { slot, staticValue, flatKey: null, parts: path.split('.') };
}

function getSnapshotPlan(definition: ScopeDefinitionMeta): SnapshotStep[] {
	const cached = snapshotPlanCache.get(definition);
	if (cached) return cached;

	const plan: SnapshotStep[] = [];
	for (let slot = 0; slot < definition.slotCount; slot++) {
		plan.push(makeStep(definition.slots[slot]!.path, slot, undefined));
	}
	for (const [path, value] of definition.staticEntries) {
		plan.push(makeStep(path, -1, value));
	}

	snapshotPlanCache.set(definition, plan);
	return plan;
}

/**
 * Build a plain snapshot of all values.
 *
 * When `tracked` is true the reactive slots are read with Preact tracking, so
 * a caller running inside a `computed`/`effect` establishes a dependency on
 * every slot in one pass (the snapshot memo relies on this to invalidate
 * lazily). Defaults to untracked `peek` reads for non-reactive callers.
 * @internal
 */
export function buildSnapshot(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	tracked = false,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const step of getSnapshotPlan(definition)) {
		let value: unknown;
		if (step.slot === -1) {
			value = step.staticValue;
		} else {
			value = tracked ? store.readTracked(step.slot) : store.read(step.slot);
		}
		if (step.flatKey !== null) {
			result[step.flatKey] = value;
			continue;
		}
		const parts = step.parts!;
		const last = parts.length - 1;
		let current = result;
		for (let i = 0; i < last; i++) {
			const part = parts[i]!;
			const existing = current[part];
			if (typeof existing === 'object' && existing !== null) {
				current = existing as Record<string, unknown>;
			} else {
				const next: Record<string, unknown> = {};
				current[part] = next;
				current = next;
			}
		}
		current[parts[last]!] = value;
	}

	return result;
}

/** Set values from a snapshot, only writing to value slots. @internal */
export function setSnapshotValues(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	data: Record<string, unknown>,
	pathPrefix: string,
): void {
	for (const key of Object.keys(data)) {
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;
		const value = data[key];

		// O(1) lookup, only write to value slots
		const slotIndex = definition.pathToSlot.get(path);
		const slotKind =
			slotIndex !== undefined ? definition.slots[slotIndex]!.kind : undefined;
		if (
			slotIndex !== undefined &&
			(slotKind === 'value' || slotKind === 'schema')
		) {
			store.write(slotIndex, value);
			continue;
		}

		// O(1) group lookup
		const groupIndex = definition.pathToGroup.get(path);
		if (groupIndex !== undefined) {
			if (typeof value === 'object' && value !== null) {
				setSnapshotValues(
					definition,
					store,
					value as Record<string, unknown>,
					path,
				);
			} else {
				// Group path with non-object value would otherwise silently
				// drop on the floor — visible only by inspecting state.
				console.warn(
					`valuse: $setSnapshot received a non-object value for group path "${path}". ` +
						'Expected a plain object matching the group shape. Skipping.',
				);
			}
		}
	}
}
