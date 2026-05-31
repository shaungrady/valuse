import type { KeyboardEvent } from 'react';
import 'valuse/react';
import type { PaletteInstance } from './model.js';

export function SearchPalette({ palette }: { palette: PaletteInstance }) {
	const [query, setQuery] = palette.query.use();
	const [results, resultsState] = palette.results.useAsync();
	const [highlightedIndex, setHighlightedIndex] =
		palette.highlightedIndex.use();

	const items = results ?? [];
	const lastIndex = items.length - 1;

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			setHighlightedIndex((index) =>
				Math.min(index + 1, Math.max(lastIndex, 0)),
			);
		} else if (event.key === 'ArrowUp') {
			setHighlightedIndex((index) => Math.max(index - 1, 0));
		} else if (event.key === 'Enter') {
			// Skip the debounce and search immediately. Fire-and-forget: the
			// UI updates reactively as the results resolve.
			void palette.results.flush();
		}
	};

	return (
		<div className="palette">
			<input
				aria-label="Search NASA images"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Search NASA images…"
			/>

			<div className="palette-body">
				<ul className="results" role="listbox">
					{resultsState.isPending && <li className="hint">Searching…</li>}
					{resultsState.isError && (
						<li className="error">Search failed. Try again.</li>
					)}
					{resultsState.status !== 'setting' &&
						items.length === 0 &&
						query.trim().length >= 2 && <li className="hint">No results.</li>}
					{items.map((result, index) => (
						<li
							key={result.nasaId}
							role="option"
							aria-selected={index === highlightedIndex}
							onMouseEnter={() => setHighlightedIndex(index)}
						>
							<strong>{result.title}</strong>
							<span>{result.center}</span>
						</li>
					))}
				</ul>

				<PreviewPane palette={palette} />
			</div>
		</div>
	);
}

export function PreviewPane({ palette }: { palette: PaletteInstance }) {
	const [preview, previewState] = palette.preview.useAsync();

	if (previewState.isPending) {
		return <aside className="preview">Loading…</aside>;
	}
	if (!preview) {
		return <aside className="preview">Highlight a result to preview it.</aside>;
	}

	return (
		<aside className="preview">
			<img src={preview.imageUrl} alt={preview.title} />
			<h3>{preview.title}</h3>
			<p>{preview.description}</p>
		</aside>
	);
}
