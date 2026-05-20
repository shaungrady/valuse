/**
 * Project a snapshot down to a subset of top-level fields. When `fields` is
 * undefined, returns a shallow copy of `snapshot` (so callers that retain the
 * result — e.g. history stack entries — are immune to aliasing). When fields
 * is provided, returns a new object containing only the entries whose keys
 * appear in the list and exist on the snapshot.
 *
 * Shared by the history, devtools, and persistence middlewares; each had its
 * own near-identical copy before this extraction.
 *
 * @internal
 */
export function pickFields(
	snapshot: Record<string, unknown>,
	fields: string[] | undefined,
): Record<string, unknown> {
	if (!fields) return { ...snapshot };
	const filtered: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in snapshot) {
			filtered[field] = snapshot[field];
		}
	}
	return filtered;
}
