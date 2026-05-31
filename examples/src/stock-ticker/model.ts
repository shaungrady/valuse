import { value, valueRef, valueScope } from 'valuse';

// Market status — shared across all tickers. Tests assign their own
// market-open state by reading/writing this through the scope ref.
export const isMarketOpen = value<boolean>(false);

// Per-symbol fetch hook so tests can inject a fake price stream without
// monkey-patching WebSocket. In a real app this would be the actual
// WebSocket setup inside the async derivation.
export interface PriceStream {
	subscribe(onPrice: (price: number) => void): () => void;
}

export type PriceStreamFactory = (symbol: string) => PriceStream;

let activeFactory: PriceStreamFactory | null = null;

/** Install a price-stream factory. Tests use this to inject a fake. */
export function setPriceStreamFactory(
	factory: PriceStreamFactory | null,
): void {
	activeFactory = factory;
}

function getStream(symbol: string): PriceStream {
	if (!activeFactory) {
		throw new Error(
			'No price-stream factory installed. Call setPriceStreamFactory() first.',
		);
	}
	return activeFactory(symbol);
}

export const stockScope = valueScope(
	{
		symbol: value<string>(),
		prevClose: value<number>(0),
		isMarketOpen: valueRef(isMarketOpen),
	},
	{
		// Long-running async derivation. Opens a price stream and pushes
		// updates via `set()`. When `symbol` changes, the abort signal
		// fires, `onCleanup` closes the stream, and a new one opens. When
		// the instance becomes unused (last subscriber detaches), the
		// same teardown runs.
		price: async ({ scope, set, onCleanup }) => {
			const symbol = scope.symbol.use();
			if (!symbol) return;
			const stream = getStream(symbol);
			const unsub = stream.subscribe(set as (v: number) => void);
			onCleanup(() => {
				unsub();
			});
			// No `return` — values come from `set()` via stream messages.
		},
	},
	{
		change: ({ scope }) => {
			const price = scope.price.use();
			const prev = scope.prevClose.use();
			return price != null ? price - prev : 0;
		},
		changePercent: ({ scope }) => {
			const prev = scope.prevClose.use();
			const price = scope.price.use();
			if (!prev || price == null) return 0;
			return ((price - prev) / prev) * 100;
		},
		isTrading: ({ scope }) =>
			scope.isMarketOpen.use() && scope.price.use() != null,
	},
	{
		// `isUp` reads `change`, so it belongs in a later layer — siblings
		// within a single derivation layer aren't visible to each other.
		isUp: ({ scope }) => scope.change.use() >= 0,
	},
);

export const watchlist = stockScope.createMap<string>();
