/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { ScopeConfig } from './scope-config.js';

/**
 * Known config-layer keys. The runtime treats the last variadic arg as
 * a config layer if every own key on it appears in this set (an empty
 * object qualifies, which is how the trailing `{}` disambiguator works).
 * Anything else is a derivation layer.
 * @internal
 */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
	'onCreate',
	'onDestroy',
	'onChange',
	'beforeChange',
	'onUsed',
	'onUnused',
	'validate',
	'allowUndeclaredProperties',
]);

function isConfigLayer(value: unknown): value is ScopeConfig {
	if (!value || typeof value !== 'object') return false;
	for (const key of Object.keys(value)) {
		if (!CONFIG_KEYS.has(key)) return false;
	}
	return true;
}

/**
 * Collapse a variadic args list `(fields, ...derivations, config?)` into
 * a single merged definition plus optional config. The first arg is the
 * field layer; the last arg is the config layer if (and only if) every
 * own key on it is a known config key; everything between is a
 * derivation layer.
 *
 * Plain-object subtrees are deep-merged so a derivation layer can extend
 * a field layer's nested object. Reactive primitives and functions are
 * leaves; B replaces A on collision.
 *
 * @internal
 */
export function collapseLayers(args: unknown[]): {
	definition: Record<string, unknown>;
	layers: ReadonlyArray<Record<string, unknown>>;
	config: ScopeConfig | undefined;
} {
	if (args.length === 0) {
		throw new TypeError('valueScope: at least one layer required.');
	}

	let lastLayerIndex = args.length - 1;
	let config: ScopeConfig | undefined;
	// Only consider the LAST arg as a config layer; middle args are
	// always derivation layers, even if they happen to be empty or to
	// contain only hook-named entries.
	if (args.length > 1 && isConfigLayer(args[lastLayerIndex])) {
		config = args[lastLayerIndex] as ScopeConfig;
		lastLayerIndex -= 1;
	}

	// Layer-by-layer record of every non-config arg, preserved for the
	// flush pipeline. Index 0 is the field layer; subsequent entries
	// are derivation layers, in declaration order.
	const layers: Array<Record<string, unknown>> = [];
	for (let i = 0; i <= lastLayerIndex; i += 1) {
		layers.push(args[i] as Record<string, unknown>);
	}

	let merged = layers[0]!;
	for (let i = 1; i < layers.length; i += 1) {
		merged = deepMergeLayers(merged, layers[i]!);
	}

	return { definition: merged, layers, config };
}

/**
 * Runtime counterpart to the `DeepMerge<A, B>` type. Plain-object
 * subtrees recurse; leaves (reactive primitives, functions, anything
 * non-plain-object) follow shallow-override semantics (B replaces A).
 * @internal
 */
export function deepMergeLayers(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...a };
	for (const [key, bValue] of Object.entries(b)) {
		const aValue = a[key];
		if (isPlainGroup(aValue) && isPlainGroup(bValue)) {
			result[key] = deepMergeLayers(
				aValue as Record<string, unknown>,
				bValue as Record<string, unknown>,
			);
		} else {
			result[key] = bValue;
		}
	}
	return result;
}

/**
 * Predicate matching the type-level `IsGroup<T>` check. A plain-object
 * subtree is anything that isn't a reactive primitive, ref, collection,
 * or function. We rely on `[Symbol.toStringTag]` being absent (none of
 * the reactive classes set it) and the object having a plain-Object
 * prototype chain.
 * @internal
 */
function isPlainGroup(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (typeof (value as { __brand?: unknown }).__brand === 'string')
		return false;
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null;
}
