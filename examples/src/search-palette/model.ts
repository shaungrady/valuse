import { value, valueScope } from 'valuse';

/** One search hit, shaped from the NASA Image Library search response. */
export interface SearchResult {
	nasaId: string;
	title: string;
	description: string;
	center: string;
	thumbnail: string;
}

/** Detail shown in the preview pane. */
export interface Preview {
	nasaId: string;
	title: string;
	description: string;
	imageUrl: string;
}

const SEARCH_URL = 'https://images-api.nasa.gov/search';
const ASSET_URL = 'https://images-api.nasa.gov/asset';

// NASA asset hrefs come back as http://; upgrade so they aren't blocked as
// mixed content on an https page.
const toHttps = (url: string): string => url.replace(/^http:\/\//, 'https://');

interface NasaSearchItem {
	data?: Array<{
		nasa_id?: string;
		title?: string;
		description?: string;
		center?: string;
	}>;
	links?: Array<{ href?: string; rel?: string }>;
}

/** Parse the search response defensively — items can lack data or a preview. */
function parseSearch(json: unknown): SearchResult[] {
	const items =
		(json as { collection?: { items?: NasaSearchItem[] } }).collection?.items ??
		[];
	const results: SearchResult[] = [];
	for (const item of items) {
		const meta = item.data?.[0];
		const preview = item.links?.find((link) => link.rel === 'preview')?.href;
		// Skip items with no id or no thumbnail — nothing to show or cascade on.
		if (!meta?.nasa_id || !preview) continue;
		results.push({
			nasaId: meta.nasa_id,
			title: meta.title ?? '(untitled)',
			description: meta.description ?? '',
			center: meta.center ?? '',
			thumbnail: toHttps(preview),
		});
	}
	return results;
}

/** Pick the large rendition from the asset response, falling back to the thumb. */
function parseLargeImage(json: unknown, fallback: string): string {
	const items =
		(json as { collection?: { items?: Array<{ href?: string }> } }).collection
			?.items ?? [];
	const large = items.find((entry) => entry.href?.includes('~large.jpg'))?.href;
	return large ? toHttps(large) : fallback;
}

/**
 * Build a fresh command-palette instance. Tests use this for isolated state
 * (including a per-instance search cache); an app calls it once.
 */
export function createSearchPalette() {
	// Per-instance cache: re-typing a settled query is an instant hit, and
	// tests don't share state across cases.
	const searchCache = new Map<string, SearchResult[]>();

	const palette = valueScope(
		{
			// Raw input, bound to the box. Normalization happens downstream so
			// the input shows exactly what was typed.
			query: value<string>(''),
			highlightedIndex: value<number>(0),
		},
		{
			// Normalize + gate: trim, lowercase, require >= 2 chars. Returns
			// null until the query is searchable. Derivations dedup on output,
			// so a trailing space or a sub-2-char edit triggers nothing below.
			normalizedQuery: ({ scope }) => {
				const q = scope.query.use().trim().toLowerCase();
				return q.length >= 2 ? q : null;
			},
		},
		{
			// Debounced, cached search. A cache hit returns instantly (no
			// debounce, no network); a miss waits 200ms then fetches. A new
			// keystroke aborts the in-flight fetch via `signal`.
			results: async ({ scope, signal, deferBy }) => {
				const q = scope.normalizedQuery.use();
				if (!q) return [];

				const cached = searchCache.get(q);
				if (cached) return cached;

				await deferBy(200);
				const response = await fetch(
					`${SEARCH_URL}?q=${encodeURIComponent(q)}&media_type=image`,
					{ signal },
				);
				const results = parseSearch(await response.json());
				searchCache.set(q, results);
				return results;
			},
		},
		{
			// Cascading async + progressive image load. Reads `results` as if
			// it were sync. Emits the thumbnail we already have for an instant
			// paint (`set`), then fetches the asset renditions and upgrades to
			// the large image. Arrowing to another result aborts the in-flight
			// asset fetch via `signal`.
			preview: async ({ scope, set, signal }) => {
				const selected = scope.results.use()?.[scope.highlightedIndex.use()];
				if (!selected) return null;

				const base = {
					nasaId: selected.nasaId,
					title: selected.title,
					description: selected.description,
				};
				set({ ...base, imageUrl: selected.thumbnail }); // instant thumb

				const response = await fetch(`${ASSET_URL}/${selected.nasaId}`, {
					signal,
				});
				const imageUrl = parseLargeImage(
					await response.json(),
					selected.thumbnail,
				);
				return { ...base, imageUrl }; // upgrade to large
			},
		},
		{
			// A new result set resets the highlight to the top.
			onChange: ({ scope, changesByScope }) => {
				if (changesByScope.has(scope.results)) {
					scope.highlightedIndex.set(0);
				}
			},
		},
	).create();

	return { palette, searchCache };
}

export type SearchPalette = ReturnType<typeof createSearchPalette>;
export type PaletteInstance = SearchPalette['palette'];
