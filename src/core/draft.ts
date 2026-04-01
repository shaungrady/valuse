/**
 * Applies mutations to a Set via a draft proxy.
 * The mutator writes to a lightweight proxy that records adds and deletes.
 * Returns the original Set if nothing changed, or a new Set with the mutations applied.
 *
 * @param source - the original immutable Set
 * @param mutator - a callback that mutates the draft
 * @returns the original `source` if unchanged, or a new Set with mutations applied
 *
 * @internal
 */
export function draftSet<T>(
	source: Set<T>,
	mutator: (draft: Set<T>) => void,
): Set<T> {
	const added: T[] = [];
	const deleted: T[] = [];

	const draft: Set<T> = {
		[Symbol.iterator]: () => source[Symbol.iterator](),
		[Symbol.toStringTag]: 'Set',
		get size() {
			return source.size + added.length - deleted.length;
		},
		has: (v: T) => (added.includes(v) || source.has(v)) && !deleted.includes(v),
		add(v: T) {
			if (!source.has(v) && !added.includes(v)) {
				added.push(v);
			}
			return draft;
		},
		delete(v: T) {
			if (source.has(v) && !deleted.includes(v)) {
				deleted.push(v);
				return true;
			}
			return false;
		},
		clear() {
			for (const v of source) {
				if (!deleted.includes(v)) {
					deleted.push(v);
				}
			}
			added.length = 0;
		},
		forEach: (fn: (value: T, key: T, set: Set<T>) => void) => {
			for (const v of source) {
				if (!deleted.includes(v)) fn(v, v, draft);
			}
			for (const v of added) {
				fn(v, v, draft);
			}
		},
		keys: () => draft.values(),
		values: () => {
			const result: T[] = [];
			for (const v of source) {
				if (!deleted.includes(v)) result.push(v);
			}
			for (const v of added) {
				result.push(v);
			}
			return result[Symbol.iterator]();
		},
		entries: () => {
			const result: [T, T][] = [];
			for (const v of source) {
				if (!deleted.includes(v)) result.push([v, v]);
			}
			for (const v of added) {
				result.push([v, v]);
			}
			return result[Symbol.iterator]();
		},
	} as Set<T>;

	mutator(draft);

	if (added.length === 0 && deleted.length === 0) {
		return source;
	}

	const result = new Set(source);
	for (const v of deleted) {
		result.delete(v);
	}
	for (const v of added) {
		result.add(v);
	}
	return result;
}

/**
 * Applies mutations to a Map via a draft proxy.
 * The mutator writes to a lightweight proxy that records puts and deletes.
 * Returns the original Map if nothing changed, or a new Map with the mutations applied.
 *
 * @param source - the original immutable Map
 * @param mutator - a callback that mutates the draft
 * @returns the original `source` if unchanged, or a new Map with mutations applied
 *
 * @internal
 */
export function draftMap<K, V>(
	source: Map<K, V>,
	mutator: (draft: Map<K, V>) => void,
): Map<K, V> {
	const pendingPuts = new Map<K, V>();
	const pendingDeletes = new Set<K>();

	const draft: Map<K, V> = {
		[Symbol.iterator]: () => draft.entries(),
		[Symbol.toStringTag]: 'Map',
		get size() {
			let count = source.size;
			for (const key of pendingPuts.keys()) {
				if (!source.has(key)) count++;
			}
			count -= pendingDeletes.size;
			return count;
		},
		has: (key: K) =>
			(pendingPuts.has(key) || source.has(key)) && !pendingDeletes.has(key),
		get: (key: K) => {
			if (pendingDeletes.has(key)) return undefined;
			if (pendingPuts.has(key)) return pendingPuts.get(key);
			return source.get(key);
		},
		set(key: K, value: V) {
			pendingPuts.set(key, value);
			pendingDeletes.delete(key);
			return draft;
		},
		delete(key: K) {
			if (source.has(key) || pendingPuts.has(key)) {
				pendingDeletes.add(key);
				pendingPuts.delete(key);
				return true;
			}
			return false;
		},
		clear() {
			pendingPuts.clear();
			for (const key of source.keys()) {
				pendingDeletes.add(key);
			}
		},
		forEach: (fn: (value: V, key: K, map: Map<K, V>) => void) => {
			for (const [key, value] of source) {
				if (!pendingDeletes.has(key))
					fn(pendingPuts.get(key) ?? value, key, draft);
			}
			for (const [key, value] of pendingPuts) {
				if (!source.has(key)) fn(value, key, draft);
			}
		},
		keys: () => {
			const result: K[] = [];
			for (const key of source.keys()) {
				if (!pendingDeletes.has(key)) result.push(key);
			}
			for (const key of pendingPuts.keys()) {
				if (!source.has(key)) result.push(key);
			}
			return result[Symbol.iterator]();
		},
		values: () => {
			const result: V[] = [];
			for (const [key, value] of source) {
				if (!pendingDeletes.has(key))
					result.push(pendingPuts.get(key) ?? value);
			}
			for (const [key, value] of pendingPuts) {
				if (!source.has(key)) result.push(value);
			}
			return result[Symbol.iterator]();
		},
		entries: () => {
			const result: [K, V][] = [];
			for (const [key, value] of source) {
				if (!pendingDeletes.has(key))
					result.push([key, pendingPuts.get(key) ?? value]);
			}
			for (const [key, value] of pendingPuts) {
				if (!source.has(key)) result.push([key, value]);
			}
			return result[Symbol.iterator]();
		},
	} as Map<K, V>;

	mutator(draft);

	if (pendingPuts.size === 0 && pendingDeletes.size === 0) {
		return source;
	}

	const result = new Map(source);
	for (const key of pendingDeletes) {
		result.delete(key);
	}
	for (const [key, value] of pendingPuts) {
		result.set(key, value);
	}
	return result;
}
