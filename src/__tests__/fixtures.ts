import type {
	ScopeDefinitionMeta,
	SlotMeta,
	GroupMeta,
} from '../core/slot-meta.js';

/**
 * Hand-built {@link ScopeDefinitionMeta} fixtures shared by the unit tests that
 * exercise {@link InstanceStore} and the field wrappers directly (without going
 * through `valueScope()`). Kept in one place so the definition shape only has to
 * be updated once when a field is added to the metadata.
 */

/** A `value`-kind slot with sensible defaults; override any field. */
export function makeSlotMeta(overrides: Partial<SlotMeta> = {}): SlotMeta {
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

/** A root group owning the given child slot indices. */
export function makeRootGroup(childSlots: number[]): GroupMeta {
	return {
		path: '',
		fieldName: '',
		index: 0,
		ancestorGroupIndices: [],
		childSlots,
		childGroups: [],
	};
}

/** A full definition from slots (and optional groups), mirroring `buildScopeDefinition`. */
export function makeDefinition(
	slots: SlotMeta[],
	groups?: GroupMeta[],
): ScopeDefinitionMeta {
	const slotsOfKind = (kind: SlotMeta['kind']): number[] =>
		slots.flatMap((s, i) => (s.kind === kind ? [i] : []));
	return {
		slotCount: slots.length,
		slots,
		groups: groups ?? [makeRootGroup(slots.map((_, i) => i))],
		staticEntries: new Map(),
		pathToSlot: new Map(slots.map((s, i) => [s.path, i])),
		pathToGroup: new Map(),
		derivedSlots: slotsOfKind('derived'),
		asyncDerivedSlots: slotsOfKind('asyncDerived'),
		schemaSlots: slotsOfKind('schema'),
		factorySlots: slots.flatMap((s, i) =>
			s.pipeline?.some((step) => step.kind === 'factory') ? [i] : [],
		),
		refEntries: new Map(),
	};
}
