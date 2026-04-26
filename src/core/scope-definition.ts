import { isValueInstance } from './value.js';
import { isValueSchemaInstance } from './value-schema.js';
import { ValuePlain } from './value-plain.js';
import { ValueRef } from './value-ref.js';
import type {
	ScopeDefinitionMeta,
	SlotMeta,
	GroupMeta,
	DefinitionPipeStep,
} from './slot-meta.js';
import type { AnyValueRef } from './value-ref.js';
import type { Comparator } from './types.js';

/** Prototype for async function detection. @internal */
const AsyncFunction = (async () => {}).constructor;

/**
 * Walk a scope definition tree and produce the shared {@link ScopeDefinitionMeta}.
 *
 * Runs once at definition time (when {@link valueScope} is called) and the
 * result is shared across all instances of this scope.
 *
 * @internal
 */
export function buildScopeDefinition(
	definition: Record<string, unknown>,
): ScopeDefinitionMeta {
	const slots: SlotMeta[] = [];
	const groups: GroupMeta[] = [];
	const staticEntries = new Map<string, unknown>();
	const refEntries = new Map<string, AnyValueRef>();

	// Root group (index 0)
	const rootGroup: GroupMeta = {
		path: '',
		fieldName: '',
		index: 0,
		ancestorGroupIndices: [],
		childSlots: [],
		childGroups: [],
	};
	groups.push(rootGroup);

	walkTree(
		definition,
		'',
		rootGroup,
		[],
		slots,
		groups,
		staticEntries,
		refEntries,
	);

	// Build lookup maps
	const pathToSlot = new Map<string, number>();
	for (let i = 0; i < slots.length; i++) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		pathToSlot.set(slots[i]!.path, i);
	}
	const pathToGroup = new Map<string, number>();
	for (let i = 0; i < groups.length; i++) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const group = groups[i]!;
		if (group.path) pathToGroup.set(group.path, i);
	}

	return {
		slotCount: slots.length,
		slots,
		groups,
		staticEntries,
		pathToSlot,
		pathToGroup,
		refEntries,
	};
}

function walkTree(
	node: Record<string, unknown>,
	pathPrefix: string,
	parentGroup: GroupMeta,
	ancestorGroupIndices: number[],
	slots: SlotMeta[],
	groups: GroupMeta[],
	staticEntries: Map<string, unknown>,
	refEntries: Map<string, AnyValueRef>,
): void {
	// Ancestors for slots at this level: all ancestor groups + the direct parent.
	// For top-level slots (parent is root group), this is empty since root
	// bubbling is handled by the InstanceStore adding the root instance separately.
	const slotAncestors =
		parentGroup.index === 0 ?
			[]
		:	[...ancestorGroupIndices, parentGroup.index].filter((i) => i !== 0);

	for (const key of Object.keys(node)) {
		const entry = node[key];
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;

		if (isValueSchemaInstance(entry)) {
			// Schema-validated reactive value field
			const schemaInstance = entry;
			const slotIndex = slots.length;

			const pipeSteps: DefinitionPipeStep[] | null =
				schemaInstance._pipeSteps.length > 0 ?
					schemaInstance._pipeSteps.map((step) =>
						step.kind === 'sync' ?
							{ kind: 'sync' as const, transform: step.transform }
						:	{ kind: 'factory' as const, descriptor: step.descriptor },
					)
				:	null;

			slots.push({
				path,
				fieldName: key,
				kind: 'schema',
				pipeline: pipeSteps,
				comparator: schemaInstance._comparator ?? null,
				defaultValue: schemaInstance._signal.peek(),
				ancestorGroupIndices: slotAncestors,
				derivationFn: null,
				schema: schemaInstance._schema,
				readonly: false,
			});

			parentGroup.childSlots.push(slotIndex);
			continue;
		}

		if (isValueInstance(entry)) {
			// Reactive value field
			const valueInstance = entry;
			const slotIndex = slots.length;

			const pipeSteps: DefinitionPipeStep[] | null =
				valueInstance._pipeSteps.length > 0 ?
					valueInstance._pipeSteps.map((step) =>
						step.kind === 'sync' ?
							{ kind: 'sync' as const, transform: step.transform }
						:	{ kind: 'factory' as const, descriptor: step.descriptor },
					)
				:	null;

			slots.push({
				path,
				fieldName: key,
				kind: 'value',
				pipeline: pipeSteps,
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				comparator: (valueInstance._comparator as Comparator<unknown>) ?? null,
				defaultValue: valueInstance._signal.peek(),
				ancestorGroupIndices: slotAncestors,
				derivationFn: null,
				schema: null,
				readonly: false,
			});

			parentGroup.childSlots.push(slotIndex);
			continue;
		}

		if (entry instanceof ValuePlain) {
			// Non-reactive plain value field
			const slotIndex = slots.length;

			const pipeSteps: DefinitionPipeStep[] | null =
				entry._pipeSteps.length > 0 ?
					entry._pipeSteps.map((step) => ({
						kind: 'sync' as const,
						transform: step.transform,
					}))
				:	null;

			slots.push({
				path,
				fieldName: key,
				kind: 'plain',
				pipeline: pipeSteps,
				comparator: null,
				defaultValue: entry._value,
				ancestorGroupIndices: slotAncestors,
				derivationFn: null,
				schema: null,
				readonly: entry._readonly === true,
			});

			parentGroup.childSlots.push(slotIndex);
			continue;
		}

		if (typeof entry === 'function') {
			// Derivation (sync or async)
			const isAsync = entry instanceof AsyncFunction;
			const slotIndex = slots.length;

			slots.push({
				path,
				fieldName: key,
				kind: isAsync ? 'asyncDerived' : 'derived',
				pipeline: null,
				comparator: null,
				defaultValue: undefined,
				ancestorGroupIndices: slotAncestors,
				derivationFn: entry as (...args: unknown[]) => unknown,
				schema: null,
				readonly: false,
			});

			parentGroup.childSlots.push(slotIndex);
			continue;
		}

		if (entry instanceof ValueRef) {
			// ValueRef: resolved per-instance in createScopeInstance
			refEntries.set(path, entry);
			continue;
		}

		if (isPlainObject(entry)) {
			// Grouping node — recurse
			const groupIndex = groups.length;
			const childAncestors = [...ancestorGroupIndices, parentGroup.index];
			const group: GroupMeta = {
				path,
				fieldName: key,
				index: groupIndex,
				ancestorGroupIndices: childAncestors,
				childSlots: [],
				childGroups: [],
			};
			groups.push(group);
			parentGroup.childGroups.push(groupIndex);

			walkTree(
				entry,
				path,
				group,
				childAncestors,
				slots,
				groups,
				staticEntries,
				refEntries,
			);
			continue;
		}

		// Everything else: static data (frozen)
		staticEntries.set(path, Object.freeze(entry));
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
