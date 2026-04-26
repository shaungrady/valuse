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
	const added = new Set<T>();
	const deleted = new Set<T>();

	function* draftValues(): IterableIterator<T> {
		for (const value of source) {
			if (!deleted.has(value)) yield value;
		}
		for (const value of added) {
			yield value;
		}
	}

	const draft: Set<T> = {
		[Symbol.iterator]: () => draftValues(),
		[Symbol.toStringTag]: 'Set',
		get size() {
			return source.size + added.size - deleted.size;
		},
		has: (value: T) =>
			(added.has(value) || source.has(value)) && !deleted.has(value),
		add(value: T) {
			if (!source.has(value)) added.add(value);
			deleted.delete(value);
			return draft;
		},
		delete(value: T) {
			if (added.has(value)) {
				added.delete(value);
				return true;
			}
			if (source.has(value) && !deleted.has(value)) {
				deleted.add(value);
				return true;
			}
			return false;
		},
		clear() {
			for (const value of source) deleted.add(value);
			added.clear();
		},
		forEach: (fn: (value: T, key: T, set: Set<T>) => void) => {
			for (const value of draftValues()) fn(value, value, draft);
		},
		keys: () => draftValues(),
		values: () => draftValues(),
		entries: function* () {
			for (const value of draftValues()) yield [value, value] as [T, T];
		},
	} as Set<T>;

	mutator(draft);

	if (added.size === 0 && deleted.size === 0) {
		return source;
	}

	const result = new Set(source);
	for (const value of deleted) result.delete(value);
	for (const value of added) result.add(value);
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

	function* draftEntries(): IterableIterator<[K, V]> {
		for (const [key, value] of source) {
			if (pendingDeletes.has(key)) continue;
			yield [key, pendingPuts.has(key) ? (pendingPuts.get(key) as V) : value];
		}
		for (const [key, value] of pendingPuts) {
			if (!source.has(key)) yield [key, value];
		}
	}

	const draft: Map<K, V> = {
		[Symbol.iterator]: () => draftEntries(),
		[Symbol.toStringTag]: 'Map',
		get size() {
			let count = source.size - pendingDeletes.size;
			for (const key of pendingPuts.keys()) {
				if (!source.has(key)) count++;
			}
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
			for (const key of source.keys()) pendingDeletes.add(key);
		},
		forEach: (fn: (value: V, key: K, map: Map<K, V>) => void) => {
			for (const [key, value] of draftEntries()) fn(value, key, draft);
		},
		keys: function* () {
			for (const [key] of draftEntries()) yield key;
		},
		values: function* () {
			for (const [, value] of draftEntries()) yield value;
		},
		entries: () => draftEntries(),
	} as Map<K, V>;

	mutator(draft);

	if (pendingPuts.size === 0 && pendingDeletes.size === 0) {
		return source;
	}

	const result = new Map(source);
	for (const key of pendingDeletes) result.delete(key);
	for (const [key, value] of pendingPuts) result.set(key, value);
	return result;
}
