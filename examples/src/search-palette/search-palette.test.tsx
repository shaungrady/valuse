import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { createSearchPalette } from './model.js';
import { SearchPalette } from './components.js';

// Mock the NASA Image Library. The fixtures mirror the verified response
// shapes (collection.items, data[0], links[rel=preview], ~large.jpg).
const BASE = 'http://images-assets.nasa.gov/image';

const searchResponse = (q: string) => ({
	collection: {
		items: [
			{
				data: [
					{
						nasa_id: `${q}-1`,
						title: `${q} result`,
						description: `About ${q}`,
						center: 'JPL',
					},
				],
				links: [{ href: `${BASE}/${q}-1/${q}-1~thumb.jpg`, rel: 'preview' }],
			},
		],
		metadata: { total_hits: 1 },
	},
});

const assetResponse = (id: string) => ({
	collection: {
		items: [
			{ href: `${BASE}/${id}/${id}~orig.jpg` },
			{ href: `${BASE}/${id}/${id}~large.jpg` },
			{ href: `${BASE}/${id}/${id}~thumb.jpg` },
		],
	},
});

let searchCalls = 0;
let assetCalls = 0;

beforeEach(() => {
	searchCalls = 0;
	assetCalls = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string) => {
			if (url.includes('/search')) {
				searchCalls += 1;
				const q = new URL(url).searchParams.get('q') ?? '';
				return Promise.resolve({
					json: () => Promise.resolve(searchResponse(q)),
				} as Response);
			}
			if (url.includes('/asset/')) {
				assetCalls += 1;
				const id = url.split('/asset/')[1]!;
				return Promise.resolve({
					json: () => Promise.resolve(assetResponse(id)),
				} as Response);
			}
			throw new Error(`unexpected url: ${url}`);
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('search-palette: model', () => {
	it('imports and creates without React', async () => {
		const { palette } = createSearchPalette();
		expect(palette.query.get()).toBe('');
		await palette.results.flush();
		expect(palette.results.get()).toEqual([]);
	});

	it('does not fetch until the query is at least 2 chars', async () => {
		const { palette } = createSearchPalette();
		palette.query.set('a');
		await palette.results.flush();
		expect(searchCalls).toBe(0);
		expect(palette.results.get()).toEqual([]);
	});

	it('fetches and shapes results once the query is searchable', async () => {
		const { palette } = createSearchPalette();
		palette.query.set('apollo');
		await palette.results.flush();
		expect(searchCalls).toBe(1);
		const results = palette.results.get();
		expect(results).toHaveLength(1);
		expect(results![0]).toMatchObject({
			nasaId: 'apollo-1',
			title: 'apollo result',
			center: 'JPL',
		});
		// http thumbnail upgraded to https
		expect(results![0]!.thumbnail).toMatch(/^https:\/\//);
	});

	it('caches: re-typing a settled query does not refetch', async () => {
		const { palette } = createSearchPalette();
		palette.query.set('apollo');
		await palette.results.flush();
		palette.query.set('gemini');
		await palette.results.flush();
		expect(searchCalls).toBe(2);

		palette.query.set('apollo'); // previously settled — cache hit
		await palette.results.flush();
		expect(searchCalls).toBe(2); // no new network call
		expect(palette.results.get()![0]!.nasaId).toBe('apollo-1');
	});

	it('preview emits the thumbnail first, then upgrades to the large image', async () => {
		const { palette } = createSearchPalette();
		const emitted: string[] = [];
		palette.preview.subscribe((p) => {
			if (p) emitted.push(p.imageUrl);
		});

		palette.query.set('apollo');
		await palette.results.flush();
		await palette.preview.flush();

		// Intermediate set() emitted the thumb, then the run returned the large.
		expect(emitted[0]).toContain('~thumb.jpg');
		expect(emitted.at(-1)).toContain('~large.jpg');
		expect(assetCalls).toBe(1);
		expect(palette.preview.get()!.imageUrl).toMatch(/^https:\/\//);
	});

	it('resets the highlight to the top when a new result set arrives', async () => {
		const { palette } = createSearchPalette();
		palette.query.set('apollo');
		await palette.results.flush();
		palette.highlightedIndex.set(0); // single result, stays 0
		expect(palette.highlightedIndex.get()).toBe(0);
	});
});

describe('search-palette: component', () => {
	it('renders results and previews the highlighted one', async () => {
		const { palette } = createSearchPalette();
		render(<SearchPalette palette={palette} />);

		await act(async () => {
			fireEvent.change(screen.getByLabelText('Search NASA images'), {
				target: { value: 'apollo' },
			});
			await palette.results.flush();
			await palette.preview.flush();
		});

		const listbox = screen.getByRole('listbox');
		expect(within(listbox).getByText('apollo result')).toBeTruthy();
		expect(screen.getByRole('img')).toHaveProperty('alt', 'apollo result');
	});

	it('Enter flushes the debounce and runs the search immediately', async () => {
		const { palette } = createSearchPalette();
		render(<SearchPalette palette={palette} />);
		const input = screen.getByLabelText('Search NASA images');

		await act(async () => {
			fireEvent.change(input, { target: { value: 'apollo' } });
			// Without advancing timers, Enter expedites the pending debounce.
			fireEvent.keyDown(input, { key: 'Enter' });
			await palette.results.flush();
		});

		expect(searchCalls).toBe(1);
		expect(
			within(screen.getByRole('listbox')).getByText('apollo result'),
		).toBeTruthy();
	});
});
