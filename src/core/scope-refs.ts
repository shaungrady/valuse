import { ScopeMap } from './scope-map.js';
import { setNestedValue } from './scope-snapshot.js';
import type { ScopeDefinitionMeta } from './slot-meta.js';

/**
 * Resolved ValueRef sources for an instance, plus the lifecycle/teardown
 * buckets the instance needs to drive transitive onUsed/onUnused and to
 * destroy factory-created children.
 * @internal
 */
export interface ResolvedRefs {
	/** path → resolved source (scope instance, ScopeMap, Value-like, or plain). */
	resolvedRefs: Map<string, unknown>;
	/** Factory-created scope instances ($destroy) to propagate destroy to. */
	factoryRefInstances: Record<string, unknown>[];
	/** Factory-created reactive primitives (.destroy()) to tear down. */
	factoryRefDestroyables: { destroy: () => void }[];
	/** Refs with `$subscribe` (scope instances) that join transitive lifecycle. */
	transitiveLifecycleRefs: Record<string, unknown>[];
}

/**
 * Resolve every `ValueRef` in the definition into a concrete source. Factory
 * refs create a fresh per-instance source; shared refs reuse the existing one.
 * Each resolved source is wrapped (when reactive) and attached to the
 * derivation scope so derivations can `.use()`/`.get()` it.
 * @internal
 */
export function resolveRefs(
	definition: ScopeDefinitionMeta,
	derivationScope: Record<string, unknown>,
): ResolvedRefs {
	const factoryRefInstances: Record<string, unknown>[] = [];
	// Factory-created reactive primitives (Value / ValueSet / ValueMap /
	// ValueArray) expose `.destroy()` rather than `$destroy`. They were
	// previously leaked on parent destroy because the propagation block only
	// looked for `$destroy`. Track them here so they can be torn down too.
	const factoryRefDestroyables: { destroy: () => void }[] = [];
	// Refs that participate in transitive onUsed/onUnused — i.e. anything
	// with a `$subscribe` (scope instances), shared or factory-created.
	// Plain Value/Set/Map refs aren't lifecycle owners and are skipped.
	const transitiveLifecycleRefs: Record<string, unknown>[] = [];
	const resolvedRefs = new Map<string, unknown>();

	for (const [path, ref] of definition.refEntries) {
		let resolved: unknown;
		if (ref.factory) {
			resolved = ref.factory();
			// Track factory-created scope instances for destroy propagation
			if (
				typeof resolved === 'object' &&
				resolved !== null &&
				'$destroy' in resolved
			) {
				factoryRefInstances.push(resolved);
			} else if (
				typeof resolved === 'object' &&
				resolved !== null &&
				'destroy' in resolved &&
				typeof resolved.destroy === 'function'
			) {
				factoryRefDestroyables.push(resolved as { destroy: () => void });
			}
		} else {
			resolved = ref.source;
		}
		if (
			typeof resolved === 'object' &&
			resolved !== null &&
			'$subscribe' in resolved &&
			typeof resolved.$subscribe === 'function'
		) {
			transitiveLifecycleRefs.push(resolved);
		}
		resolvedRefs.set(path, resolved);
		// Attach to derivation scope for use in derivations. Wrap with a
		// DerivationWrap-compatible interface so `.use()` inside a derivation
		// performs the right kind of tracked read for each source shape.
		const wrapped = wrapRefForDerivation(resolved);
		setNestedValue(derivationScope, path, wrapped ?? resolved);
	}

	return {
		resolvedRefs,
		factoryRefInstances,
		factoryRefDestroyables,
		transitiveLifecycleRefs,
	};
}

/**
 * Wrap a resolved ref source so `.use()` inside a derivation performs the
 * right kind of tracked read for that source shape. Returns `undefined` for
 * non-reactive values (plain data, functions, etc.), in which case the raw
 * source is attached to the derivation scope as-is.
 * @internal
 */
function wrapRefForDerivation(
	resolved: unknown,
): { use: () => unknown; get: () => unknown } | undefined {
	if (typeof resolved !== 'object' || resolved === null) return undefined;

	// Scope instance: `.use()` hands back the instance itself so derivations
	// can reach into its fields and `$` methods — `scope.child.use().field.get()`,
	// `scope.form.use().$getIsValid()`. `_trackAll()` registers a dep on every
	// slot up front, so the derivation re-runs on any field change inside the
	// referenced instance. Granularity is coarse by design; it's the price of
	// letting consumers read the full instance shape.
	if ('$get' in resolved && typeof resolved.$get === 'function') {
		const instance = resolved as Record<string, unknown> & {
			_trackAll?: () => void;
		};
		return {
			use: () => {
				instance._trackAll?.();
				return instance;
			},
			get: () => instance,
		};
	}

	// ScopeMap: `.use()` tracks the key-list version signal and hands back
	// the map. Consumers then call `.size`, `.keys()`, `.get(key)`, etc.
	if (resolved instanceof ScopeMap) {
		const map = resolved;
		return {
			use: () => {
				map._trackKeys();
				return map;
			},
			get: () => map,
		};
	}

	// Any reactive source with a parameterless `.get()` — Value, ValueSet,
	// ValueMap (whole-map read), ValuePlain, etc. Preact signals inside
	// `.get()` handle tracking; `.use()` is an alias here.
	if ('get' in resolved && typeof resolved.get === 'function') {
		const source = resolved as { get(): unknown };
		return {
			use: () => source.get(),
			get: () => source.get(),
		};
	}

	return undefined;
}
