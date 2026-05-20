import { ScopeMap } from './scope-map.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

// Walkers for deep validation across reactive ref values. A "ref" here is
// whatever a scope's resolved ref slot holds — a scope instance, a ScopeMap of
// scope instances, or some other reactive primitive. The validation pipeline
// in `scope-validation` (setupValidation in value-scope.ts) reaches into these
// to (a) ask "is everything below me valid?", (b) collect issues, and (c)
// register tracking dependencies so the surrounding derivation recomputes when
// any nested validation state changes. Scope instances expose
// `_deepCollectIssues` / `_deepCheckValid` / `_trackDeepValid` for those
// purposes; ScopeMap walks its entries.

/** Walk a ref value, collecting nested issues with prefixed paths. @internal */
export function walkRefCollect(
	ref: unknown,
	visited: WeakSet<object>,
): StandardSchemaV1.Issue[] {
	if (ref instanceof ScopeMap) {
		const collected: StandardSchemaV1.Issue[] = [];
		for (const [entryKey, entry] of ref.entries()) {
			const entryIssues = walkRefCollect(entry, visited);
			for (const issue of entryIssues) {
				collected.push({
					message: issue.message,
					path: [entryKey, ...(issue.path ?? [])],
				});
			}
		}
		return collected;
	}
	if (isScopeLike(ref)) {
		const deepCollect = (ref as Record<string, unknown>)._deepCollectIssues as
			| ((visited: WeakSet<object>) => StandardSchemaV1.Issue[])
			| undefined;
		if (typeof deepCollect === 'function') return deepCollect(visited);
	}
	return [];
}

/** Walk a ref value for deep validation. Returns false if any nested scope fails. @internal */
export function walkRefValid(ref: unknown, visited: WeakSet<object>): boolean {
	if (ref instanceof ScopeMap) {
		for (const entry of ref.values()) {
			if (!walkRefValid(entry, visited)) return false;
		}
		return true;
	}
	if (isScopeLike(ref)) {
		const deepCheck = (ref as Record<string, unknown>)._deepCheckValid as
			| ((visited: WeakSet<object>) => boolean)
			| undefined;
		if (typeof deepCheck === 'function') {
			return deepCheck(visited);
		}
	}
	return true;
}

/** Walk a ref value, touching reactive signals for deep validation tracking. @internal */
export function walkRefTrack(ref: unknown, visited: WeakSet<object>): void {
	if (ref instanceof ScopeMap) {
		ref._trackKeys();
		for (const entry of ref.values()) {
			walkRefTrack(entry, visited);
		}
		return;
	}
	if (isScopeLike(ref)) {
		const trackDeep = (ref as Record<string, unknown>)._trackDeepValid as
			| ((visited: WeakSet<object>) => void)
			| undefined;
		if (typeof trackDeep === 'function') trackDeep(visited);
	}
}

export function isScopeLike(x: unknown): boolean {
	return typeof x === 'object' && x !== null && '$destroy' in x;
}
