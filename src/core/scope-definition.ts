import { isValueInstance } from './value.js';
import { isValueSchemaInstance } from './value-schema.js';
import { ValuePlain } from './value-plain.js';
import { ValueRef } from './value-ref.js';
import { ValueSet, valueSet } from './value-set.js';
import { ValueMap, valueMap } from './value-map.js';
import { ValueArray, valueArray } from './value-array.js';
import type {
	ScopeDefinitionMeta,
	SlotMeta,
	GroupMeta,
	DefinitionPipeStep,
} from './slot-meta.js';
import type { AnyValueRef } from './value-ref.js';
import type { Comparator } from './types.js';
import type { InternalPipeStep } from './utils/pipe-internal.js';

/** Prototype for async function detection. @internal */
const AsyncFunction = (async () => {}).constructor;

/**
 * Convert a Value/Schema/Plain instance's runtime pipe-step list into the
 * static {@link DefinitionPipeStep} shape stored on `SlotMeta.pipeline`.
 * Returns `null` for empty pipelines so the slot-meta carries the same
 * "no pipes" signal regardless of source.
 * @internal
 */
function buildPipeline(
	steps: readonly InternalPipeStep[],
): DefinitionPipeStep[] | null {
	if (steps.length === 0) return null;
	return steps.map((step) =>
		step.kind === 'sync' ?
			{ kind: 'sync' as const, transform: step.transform }
		:	{ kind: 'factory' as const, descriptor: step.descriptor },
	);
}

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
	for (const [i, slot] of slots.entries()) {
		pathToSlot.set(slot.path, i);
	}
	const pathToGroup = new Map<string, number>();
	for (const [i, group] of groups.entries()) {
		if (group.path) pathToGroup.set(group.path, i);
	}

	// Group slot indices by kind so per-instance setup can iterate only the
	// relevant slots. Built in ascending index order, matching the previous
	// full-scan-and-filter behavior of the setup functions.
	const slotsOfKind = (kind: SlotMeta['kind']): number[] =>
		slots.flatMap((s, i) => (s.kind === kind ? [i] : []));
	const derivedSlots = slotsOfKind('derived');
	const asyncDerivedSlots = slotsOfKind('asyncDerived');
	const schemaSlots = slotsOfKind('schema');
	// Slots whose pipeline contains a factory step (pipeDebounce, pipeThrottle,
	// …). Precomputed so `InstanceStore` can activate factory pipes by iterating
	// these directly instead of `.some()`-scanning every slot's pipeline on each
	// `.create()` — the common factory-free scope then skips the scan entirely.
	const factorySlots = slots.flatMap((s, i) =>
		s.pipeline?.some((step) => step.kind === 'factory') ? [i] : [],
	);

	return {
		slotCount: slots.length,
		slots,
		groups,
		staticEntries,
		pathToSlot,
		pathToGroup,
		derivedSlots,
		asyncDerivedSlots,
		schemaSlots,
		factorySlots,
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

			slots.push({
				path,
				fieldName: key,
				kind: 'schema',
				pipeline: buildPipeline(schemaInstance._pipeSteps),
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

			slots.push({
				path,
				fieldName: key,
				kind: 'value',
				pipeline: buildPipeline(valueInstance._pipeSteps),
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				comparator: (valueInstance._comparator as Comparator<unknown>) ?? null,
				defaultValue: valueInstance._signal.peek(),
				// Pre-actor seed captured at the template's first factory-pipe
				// step. Used by `activateFactoryPipes` to prime instance actors
				// consistently with this standalone Value.
				factorySeed: valueInstance._factorySeed,
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

			slots.push({
				path,
				fieldName: key,
				kind: 'plain',
				pipeline: buildPipeline(entry._pipeSteps),
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

		// Bare reactive collections (`valueSet`, `valueMap`, `valueArray`)
		// inside a scope definition: without this branch they'd fall through
		// to `staticEntries` (frozen, shared across every instance created
		// from the template), so e.g. `alice.hobbies.add('x')` would also
		// mutate `bob.hobbies`. The README's documented `hobbies:
		// valueSet<string>()` pattern relies on per-instance independence,
		// so we wrap each collection in a factory-style `ValueRef` that
		// rebuilds a fresh collection seeded with the definition-time
		// contents on every `.create()`. Pipes and comparators set on the
		// declared collection are not preserved by this clone; users who
		// need those should wrap explicitly with
		// `valueRef(() => valueXxx(...).pipe(...))`.
		if (entry instanceof ValueSet) {
			const initial = [...(entry.get() as Set<unknown>)];
			refEntries.set(
				path,
				new ValueRef(
					() => undefined,
					undefined,
					() => valueSet(initial),
				),
			);
			continue;
		}
		if (entry instanceof ValueMap) {
			const initial = [...(entry.get() as Map<unknown, unknown>).entries()] as [
				unknown,
				unknown,
			][];
			refEntries.set(
				path,
				new ValueRef(
					() => undefined,
					undefined,
					() => valueMap(initial),
				),
			);
			continue;
		}
		if (entry instanceof ValueArray) {
			const initial = [...(entry.get() as readonly unknown[])];
			refEntries.set(
				path,
				new ValueRef(
					() => undefined,
					undefined,
					() => valueArray(initial),
				),
			);
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
