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

export const stockScope = valueScope({
	symbol: value<string>(),
	prevClose: value<number>(0),
	isMarketOpen: valueRef(isMarketOpen),

	// Long-running async derivation. Opens a price stream and pushes updates
	// via `set()`. When `symbol` changes, the abort signal fires, `onCleanup`
	// closes the stream, and a new one opens. When the instance becomes
	// unused (last subscriber detaches), the same teardown runs.
	price: async ({
		scope,
		set,
		onCleanup,
	}: {
		scope: any;
		set: (v: number) => void;
		onCleanup: (fn: () => void) => void;
	}): Promise<void> => {
		const symbol = scope.symbol.use() as string | undefined;
		if (!symbol) return;
		const stream = getStream(symbol);
		const unsub = stream.subscribe(set);
		onCleanup(() => {
			unsub();
		});
		// No `return` — values come from `set()` via stream messages.
	},

	change: ({ scope }: { scope: any }) => {
		const price = scope.price.use() as number | undefined;
		const prev = scope.prevClose.use() as number;
		return price != null ? price - prev : 0;
	},
	changePercent: ({ scope }: { scope: any }) => {
		const prev = scope.prevClose.use() as number;
		const price = scope.price.use() as number | undefined;
		if (!prev || price == null) return 0;
		return ((price - prev) / prev) * 100;
	},
	isUp: ({ scope }: { scope: any }) => (scope.change.use() as number) >= 0,
	isTrading: ({ scope }: { scope: any }) =>
		(scope.isMarketOpen.use() as boolean) &&
		(scope.price.use() as number | undefined) != null,
});

export const watchlist = stockScope.createMap<string>();
