# Example: Command Palette Search

A command-palette search over NASA's
[Image and Video Library](https://images.nasa.gov): type a query, see results as
you type, arrow through them, and preview the highlighted image in a side pane.
This showcases **cascading async derivations** (a second derivation that reads
the first as if it were sync), in-derivation debounce with `deferBy()`, race
cancellation via `signal`, a small result cache, progressive image loading with
intermediate `set()`, and Enter-to-submit with `.flush()`. See
[Async Derivations](../docs/async-derivations.md) and
[Derivations](../docs/derivations.md) for the underlying APIs.

The runnable source is under
[`examples/src/search-palette/`](./src/search-palette/). It hits the live NASA
API (no key, CORS-open); tests mock `fetch`.

## The problem

A good search box has several concerns tangled together:

1. **Debounce.** Don't fire a request on every keystroke; wait for a pause.
2. **Race cancellation.** If the response for `"hel"` arrives after the response
   for `"hello"`, the stale result must not win.
3. **Cache.** Re-typing a previously-searched query should be instant.
4. **Enter to submit.** Pressing Enter should skip the debounce and search
   immediately.
5. **Preview.** Arrowing to a result fetches the full-resolution image for a
   preview pane, and arrowing away cancels that fetch.

In Zustand or Jotai, this is two `useEffect`s, two `AbortController`s, a
debounce ref, a cache ref, and manual loading state, all living in the view. In
ValUse it is a chain of derivations.

## The model

Two reactive fields, then three derivation layers. Each layer reads the one
above it, so they stack top to bottom; the layered shape makes the dependency
direction visible and the cascade automatic.

```ts
import { value, valueScope } from 'valuse';

interface SearchResult {
  nasaId: string;
  title: string;
  description: string;
  center: string;
  thumbnail: string;
}
interface Preview {
  nasaId: string;
  title: string;
  description: string;
  imageUrl: string;
}

// Per-instance cache: re-typing a settled query is an instant hit.
const searchCache = new Map<string, SearchResult[]>();

const palette = valueScope(
  {
    // Raw input, bound to the box. Normalization happens downstream so
    // the input shows exactly what was typed (trailing spaces, capitals).
    query: value<string>(''),
    highlightedIndex: value<number>(0),
  },
  {
    // Layer 1: normalize + gate. Trim, lowercase, require >= 2 chars;
    // return null until searchable. Derivations dedup on output, so a
    // trailing space or a sub-2-char edit triggers nothing below — the
    // debounce timer isn't even reset.
    normalizedQuery: ({ scope }) => {
      const q = scope.query.use().trim().toLowerCase();
      return q.length >= 2 ? q : null;
    },
  },
  {
    // Layer 2: debounced + cached search. A cache hit returns instantly
    // (no debounce, no network); a miss waits 200ms then fetches. A new
    // keystroke changes `normalizedQuery`, aborting this run via `signal`.
    results: async ({ scope, signal, deferBy }) => {
      const q = scope.normalizedQuery.use();
      if (!q) return [];

      const cached = searchCache.get(q);
      if (cached) return cached;

      await deferBy(200);
      const res = await fetch(
        `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`,
        { signal },
      );
      const results = parseSearch(await res.json()); // shape NASA's response
      searchCache.set(q, results);
      return results;
    },
  },
  {
    // Layer 3: cascade + progressive image load. Reads `results` as if it
    // were sync. Emits the thumbnail we already have for an instant paint
    // via `set()`, then fetches the asset renditions and upgrades to the
    // large image. Arrowing away aborts the in-flight fetch via `signal`.
    preview: async ({ scope, set, signal }) => {
      const selected = scope.results.use()?.[scope.highlightedIndex.use()];
      if (!selected) return null;

      const base = {
        nasaId: selected.nasaId,
        title: selected.title,
        description: selected.description,
      };
      set({ ...base, imageUrl: selected.thumbnail }); // instant thumb

      const res = await fetch(
        `https://images-api.nasa.gov/asset/${selected.nasaId}`,
        { signal },
      );
      const imageUrl = parseLargeImage(await res.json(), selected.thumbnail);
      return { ...base, imageUrl }; // upgrade to large
    },
  },
  {
    // A new result set resets the highlight to the top.
    onChange: ({ scope, changesByScope }) => {
      if (changesByScope.has(scope.results)) scope.highlightedIndex.set(0);
    },
  },
).create();
```

(`parseSearch` / `parseLargeImage` are small response-shaping helpers; see the
[runnable model](./src/search-palette/model.ts) for the full code, including the
`http://` → `https://` upgrade on NASA's asset URLs.)

Three layers are worth dwelling on.

`normalizedQuery` separates "what the input shows" from "what the search keys
on." Binding the input to a trimmed or lowercased value would fight the user's
typing (a trailing space would vanish, a capital would snap to lowercase),
because `.compareUsing()` and write-time pipes reject the raw value rather than
transform it for comparison only. A derivation sidesteps that: `query` stays raw
for display, `normalizedQuery` dedups for the search, and an insignificant edit
produces no downstream change.

`results` shows the cache as a plain `Map`: a hit returns synchronously (no
`deferBy`, no fetch); a miss debounces, fetches, and stores. Because each
keystroke aborts the prior run, only the _settled_ query fetches and caches — so
backspacing to a previously-seen query is an instant hit.

`preview` is the headline. It calls `scope.results.use()` and treats the value
as a plain `SearchResult[] | undefined` — it neither knows nor cares that
`results` is async. And it uses intermediate `set()` for progressive loading:
the thumbnail (already in hand from the result, browser-cached) paints
instantly, then the run upgrades to the full-resolution image once the asset
endpoint resolves. Arrowing to another result aborts the in-flight asset fetch
via `signal`.

### What happens automatically

| Event                             | What happens                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Type a meaningful character       | `query` updates; `normalizedQuery` changes; `results` schedules a 200ms `deferBy`     |
| Type a trailing space (or case)   | `query` updates; `normalizedQuery` is unchanged; nothing below re-runs, no reset      |
| Type again within 200ms           | the prior `results` run aborts before its fetch fires; a fresh 200ms `deferBy` starts |
| Type a previously-settled query   | cache hit — `results` returns synchronously, no debounce, no network                  |
| 200ms idle (cache miss)           | `deferBy` resolves; the fetch fires with the normalized query                         |
| Press Enter                       | `palette.results.flush()` resolves the `deferBy` now; the fetch fires at once         |
| Results resolve                   | `onChange` resets `highlightedIndex` to 0; `preview` runs for the top result          |
| `preview` runs                    | emits the thumbnail instantly (`set`), then fetches + upgrades to the large image     |
| Arrow up / down                   | `highlightedIndex` changes; `preview` re-runs; the prior asset fetch aborts           |
| Component unmounts / `$destroy()` | both derivations' signals abort; in-flight fetches cancel                             |

## React components

```tsx
import 'valuse/react';
import type { KeyboardEvent } from 'react';

function SearchPalette({ palette }: { palette: PaletteInstance }) {
  const [query, setQuery] = palette.query.use();
  const [results, resultsState] = palette.results.useAsync();
  const [highlightedIndex, setHighlightedIndex] =
    palette.highlightedIndex.use();

  const items = results ?? [];

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      setHighlightedIndex((i) =>
        Math.min(i + 1, Math.max(items.length - 1, 0)),
      );
    } else if (event.key === 'ArrowUp') {
      setHighlightedIndex((i) => Math.max(i - 1, 0));
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
          {resultsState.isError && <li className="error">Search failed.</li>}
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

function PreviewPane({ palette }: { palette: PaletteInstance }) {
  const [preview, previewState] = palette.preview.useAsync();

  if (previewState.isPending)
    return <aside className="preview">Loading…</aside>;
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
```

The component holds no debounce ref, no `AbortController`, no `useEffect`. It
reads reactive values and renders — `resultsState.isPending` shows the spinner,
the preview image swaps from thumb to full-res on its own. The timing,
cancellation, cache, and cascade all live in the model.

## Re-render boundaries

- The results list re-renders when `results` resolves or `highlightedIndex`
  changes, not on every keystroke. Typing updates `query`, which feeds
  `normalizedQuery`, which `results` reads. An edit that leaves
  `normalizedQuery` unchanged re-renders nothing.
- The preview pane re-renders when `preview` resolves. Arrowing through results
  re-runs `preview` and re-renders only the pane, not the list items (beyond the
  `aria-selected` toggle on two rows).

## Flushing before an action

`.flush()` returns a Promise, so a handler that needs the result in hand can
await it. For example, "press Enter to open the top result":

```ts
async function openTopResult() {
  await palette.results.flush(); // skip debounce, await the fetch
  const [first] = palette.results.get() ?? [];
  if (first) navigate(`/images/${first.nasaId}`);
}
```

Or settle the whole palette at once before serializing or snapshotting:

```ts
await palette.$flush(); // normalizedQuery, results, then preview, in layer order
```

## How this looks in Zustand

```ts
function SearchPalette() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const cacheRef = useRef(new Map<string, SearchResult[]>());

  // Search: debounce + cache + AbortController, by hand.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return setResults([]);
    const cached = cacheRef.current.get(q);
    if (cached) return setResults(cached);
    clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(
        `https://images-api.nasa.gov/search?q=${q}&media_type=image`,
        {
          signal: controller.signal,
        },
      );
      const shaped = parseSearch(await res.json());
      cacheRef.current.set(q, shaped);
      setResults(shaped);
      setHighlightedIndex(0);
    }, 200);
    return () => {
      clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [query]);

  // Preview: a second effect, a second AbortController, manual thumb→large.
  useEffect(() => {
    const selected = results[highlightedIndex];
    if (!selected) return setPreview(null);
    setPreview({ ...selected, imageUrl: selected.thumbnail }); // thumb
    const controller = new AbortController();
    fetch(`https://images-api.nasa.gov/asset/${selected.nasaId}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((json) =>
        setPreview({
          ...selected,
          imageUrl: parseLargeImage(json, selected.thumbnail),
        }),
      );
    return () => controller.abort();
  }, [results, highlightedIndex]);

  // ...render, plus an Enter handler that has to reach into the
  // debounce ref to force an early fire.
}
```

The debounce, the cache, both `AbortController`s, and the thumb→large sequencing
all live in the component, coupled to React's lifecycle. Reusing this search
outside React means lifting it all into a separate module. In ValUse it already
is one.
