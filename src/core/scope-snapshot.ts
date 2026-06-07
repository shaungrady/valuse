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

/** Build a plain snapshot of all values. @internal */
export function buildSnapshot(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	// Add reactive slot values
	for (let slot = 0; slot < definition.slotCount; slot++) {
		const meta = definition.slots[slot]!;
		setNestedValue(result, meta.path, store.read(slot));
	}

	// Add static entries
	for (const [path, value] of definition.staticEntries) {
		setNestedValue(result, path, value);
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
