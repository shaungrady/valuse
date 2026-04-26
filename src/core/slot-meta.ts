import type { Comparator, PipeFactoryDescriptor, Transform } from './types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AnyValueRef } from './value-ref.js';

/**
 * The kind of reactive node a slot represents.
 */
export type SlotKind =
	| 'value'
	| 'plain'
	| 'schema'
	| 'derived'
	| 'asyncDerived';

/**
 * A single step in a pipe chain, stored at definition time.
 */
export type DefinitionPipeStep =
	| { kind: 'sync'; transform: Transform<unknown, unknown> }
	| { kind: 'factory'; descriptor: PipeFactoryDescriptor<unknown, unknown> };

/**
 * Static metadata for a single slot, computed at scope definition time.
 * Shared across all instances of a definition.
 */
export interface SlotMeta {
	/** Dot-separated path string (e.g., 'job.title'). */
	readonly path: string;

	/** Last segment of the path (e.g., 'title' for 'job.title'). Precomputed. */
	readonly fieldName: string;

	/** What kind of reactive node this slot holds. */
	readonly kind: SlotKind;

	/** Pipe chain steps, or null if no pipes. */
	readonly pipeline: DefinitionPipeStep[] | null;

	/** Custom equality comparator, or null for default ===. */
	readonly comparator: Comparator<unknown> | null;

	/** Default value for this slot (undefined if none). */
	readonly defaultValue: unknown;

	/**
	 * Indices of ancestor grouping nodes in the instance tree, from immediate
	 * parent to root. Used for changesByScope bubbling. Empty for top-level fields.
	 */
	readonly ancestorGroupIndices: number[];

	/**
	 * The derivation function, if this slot is a derived or asyncDerived.
	 * null for value slots.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly derivationFn: ((...args: any[]) => any) | null;

	/**
	 * The Standard Schema instance, if this slot is a schema-validated value.
	 * null for non-schema slots.
	 */
	readonly schema: StandardSchemaV1 | null;

	/**
	 * Whether a `plain` slot was declared readonly. `false` for non-plain slots.
	 */
	readonly readonly: boolean;
}

/**
 * Static metadata for a grouping node (plain object in the definition tree).
 * Grouping nodes don't have signals; they're just namespacing for children.
 */
export interface GroupMeta {
	/** Dot-separated path string (e.g., 'job'). Empty string for root. */
	readonly path: string;

	/** Last segment of the path (e.g., 'job'). Empty string for root. Precomputed. */
	readonly fieldName: string;

	/** Index of this group in the groups array. */
	readonly index: number;

	/** Indices of ancestor groups, from immediate parent to root. */
	readonly ancestorGroupIndices: number[];

	/** Slot indices that are direct children of this group. */
	readonly childSlots: number[];

	/** Indices of child groups. */
	readonly childGroups: number[];
}

/**
 * All definition-time metadata for a scope. Shared across all instances.
 */
export interface ScopeDefinitionMeta {
	/** Total number of reactive slots. */
	readonly slotCount: number;

	/** Per-slot metadata, indexed by slot number. */
	readonly slots: readonly SlotMeta[];

	/** Grouping node metadata. Index 0 is always the root group. */
	readonly groups: readonly GroupMeta[];

	/**
	 * Static (frozen) entries: plain values/arrays that don't get slots.
	 * Map of path → frozen value.
	 */
	readonly staticEntries: ReadonlyMap<string, unknown>;

	/** Lookup: path string → slot index. Avoids O(n) findIndex scans. */
	readonly pathToSlot: ReadonlyMap<string, number>;

	/** Lookup: path string → group index. Avoids O(n) .some() scans. */
	readonly pathToGroup: ReadonlyMap<string, number>;

	/**
	 * ValueRef entries found in the definition tree.
	 * Map of path → ValueRef instance. Resolved per-instance in createScopeInstance.
	 */
	readonly refEntries: ReadonlyMap<string, AnyValueRef>;
}
