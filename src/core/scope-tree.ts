/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
	FieldValue,
	FieldValueSchema,
	FieldValuePlain,
	FieldDerived,
	FieldAsyncDerived,
	DerivationWrap,
} from './field-value.js';
import { setNestedValue } from './scope-snapshot.js';
import type { InstanceStore } from './instance-store.js';
import type { ScopeDefinitionMeta, GroupMeta } from './slot-meta.js';
import type { ScopeNode } from './types.js';

/** Build the derivation scope tree: same shape as instance tree, but with {@link DerivationWrap} objects at reactive leaves. @internal */
export function buildDerivationScopeTree(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	return buildDerivationGroupNode(definition, store, rootGroup);
}

function buildDerivationGroupNode(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	group: GroupMeta,
): Record<string, unknown> {
	const node: Record<string, unknown> = {};

	// Add child slots as DerivationWrap
	for (const slotIndex of group.childSlots) {
		const meta = definition.slots[slotIndex]!;
		const fieldName = meta.fieldName;
		node[fieldName] = new DerivationWrap(store, slotIndex);
	}

	// Add child groups recursively. Groups are NOT frozen here so static
	// entries can be mirrored onto them after build; freezing happens via
	// `freezeDerivationGroups` once mirroring is done.
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		node[fieldName] = buildDerivationGroupNode(definition, store, childGroup);
	}

	return node;
}

/** Recursively freeze nested groups on the derivation scope tree. @internal */
export function freezeDerivationGroups(
	definition: ScopeDefinitionMeta,
	derivationScope: Record<string, unknown>,
	group: GroupMeta,
): void {
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		const child = derivationScope[fieldName] as Record<string, unknown>;
		freezeDerivationGroups(definition, child, childGroup);
		Object.freeze(child);
	}
}

/** Build the instance tree: FieldValue/FieldDerived at reactive leaves, frozen plain objects for groups. @internal */
export function buildInstanceTree(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	nodesBySlot: Map<number, ScopeNode>,
	nodesByGroup: Map<number, ScopeNode>,
): Record<string, unknown> {
	const rootGroup = definition.groups[0]!;
	const instance = buildGroupNode(
		definition,
		store,
		rootGroup,
		nodesBySlot,
		nodesByGroup,
	);
	nodesByGroup.set(0, instance);
	return instance;
}

function buildGroupNode(
	definition: ScopeDefinitionMeta,
	store: InstanceStore,
	group: GroupMeta,
	nodesBySlot: Map<number, ScopeNode>,
	nodesByGroup: Map<number, ScopeNode>,
): Record<string, unknown> {
	const node: Record<string, unknown> = {};

	// Add child slots as FieldValue or FieldDerived
	for (const slotIndex of group.childSlots) {
		const meta = definition.slots[slotIndex]!;
		const fieldName = meta.fieldName;

		let wrapper: ScopeNode;
		switch (meta.kind) {
			case 'value':
				wrapper = new FieldValue(store, slotIndex);
				break;
			case 'schema':
				wrapper = new FieldValueSchema(store, slotIndex);
				break;
			case 'plain':
				wrapper = new FieldValuePlain(store, slotIndex);
				break;
			case 'derived':
				wrapper = new FieldDerived(store, slotIndex);
				break;
			case 'asyncDerived':
				wrapper = new FieldAsyncDerived(store, slotIndex);
				break;
		}

		node[fieldName] = wrapper;
		nodesBySlot.set(slotIndex, wrapper);
	}

	// Add child groups recursively.
	// Freezing is deferred to freezeChildGroups() so attachStaticEntries
	// can write nested paths into these objects first.
	for (const childGroupIndex of group.childGroups) {
		const childGroup = definition.groups[childGroupIndex]!;
		const fieldName = childGroup.fieldName;
		const childNode = buildGroupNode(
			definition,
			store,
			childGroup,
			nodesBySlot,
			nodesByGroup,
		);
		node[fieldName] = childNode;
		nodesByGroup.set(childGroupIndex, childNode);
	}

	return node;
}

/**
 * Freeze all non-root group nodes. Called after static entries have been
 * attached, so nested paths are writable during `attachStaticEntries`.
 * @internal
 */
export function freezeChildGroups(
	definition: ScopeDefinitionMeta,
	nodesByGroup: Map<number, ScopeNode>,
): void {
	for (
		let groupIndex = 1;
		groupIndex < definition.groups.length;
		groupIndex++
	) {
		const node = nodesByGroup.get(groupIndex);
		if (node) Object.freeze(node);
	}
}

/** Attach static entries to the instance tree. @internal */
export function attachStaticEntries(
	definition: ScopeDefinitionMeta,
	instance: Record<string, unknown>,
	derivationScope?: Record<string, unknown>,
): void {
	for (const [path, value] of definition.staticEntries) {
		setNestedValue(instance, path, value);
		// Mirror onto the derivation scope too so `scope.<staticField>` resolves
		// inside derivations / hooks instead of being undefined.
		if (derivationScope) setNestedValue(derivationScope, path, value);
	}
}
