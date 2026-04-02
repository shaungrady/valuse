# Example: Stock Ticker

A live stock price table where each row subscribes to real-time data only while
visible. This showcases async derivations with WebSocket streams and the
transitive lifecycle that activates them.

## The problem

You have a watchlist of stock symbols. Each one needs a WebSocket subscription
for live prices. But you don't want to subscribe to all of them at once — only
the ones currently rendered. When a user scrolls a row out of view, or navigates
away, the subscription should stop. When they come back, it should resume.

In Zustand or Jotai, you'd wire this up with `useEffect` in each component. The
subscription logic lives in the view layer, tangled with React lifecycle. In
ValUse, it lives in the model — as an async derivation.

## The model

```ts
import { value, valueRef, valueScope } from 'valuse';

// Market status — shared across all tickers
const isMarketOpen = value<boolean>(false);

const stock = valueScope({
  symbol: value<string>(),
  prevClose: value<number>(0),

  // Ref to shared market status
  isMarketOpen: valueRef(isMarketOpen),

  // Async derivation — opens a WebSocket, pushes price updates via set().
  // When symbol changes, the previous WebSocket is cleaned up and a new one opens.
  // When the instance is destroyed, onCleanup fires automatically.
  price: async ({ use, set, onCleanup }) => {
    const sym = use('symbol');
    const ws = new WebSocket(`wss://feed.example.com/stocks/${sym}`);
    onCleanup(() => ws.close());

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      set(data.price);
    };

    // No return — value comes from set() via WebSocket messages
  },

  // Sync derivations — don't know or care that price is async.
  // They see number | undefined and recompute when price resolves.
  change: ({ use }) => {
    const price = use('price');
    return price != null ? price - use('prevClose') : 0;
  },
  changePercent: ({ use }) => {
    const prev = use('prevClose');
    const price = use('price');
    if (!prev || price == null) return 0;
    return ((price - prev) / prev) * 100;
  },
  isUp: ({ use }) => use('change') >= 0,
  isTrading: ({ use }) => use('isMarketOpen') && use('price') != null,
});

// The watchlist
const watchlist = stock.createMap();
```

### What happens automatically

| Event                                                        | What happens                                            |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Component mounts, calls `watchlist.use("AAPL")`              | Async derivation runs, WebSocket opens                  |
| Second component also subscribes to AAPL                     | Nothing — already connected                             |
| First component unmounts                                     | Nothing — still one subscriber                          |
| Last component unmounts                                      | `onCleanup` fires, WebSocket closes                     |
| `symbol` changes on an active instance                       | Old WebSocket closes, derivation re-runs, new one opens |
| User removes AAPL from watchlist: `watchlist.delete("AAPL")` | Instance destroyed, WebSocket closes                    |

The view doesn't know about WebSockets. The model doesn't know about React.

## React components

```tsx
import { value, valueScope } from 'valuse/react';

function WatchlistTable() {
  const symbols = watchlist.useKeys();

  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Price</th>
          <th>Change</th>
        </tr>
      </thead>
      <tbody>
        {symbols.map((sym) => (
          <StockRow key={sym} symbol={sym} />
        ))}
      </tbody>
    </table>
  );
}

function StockRow({ symbol }: { symbol: string }) {
  // This subscription activates the async derivation via transitive lifecycle
  const [getStock] = watchlist.use(symbol);

  const price = getStock('price');
  const change = getStock('change');
  const pct = getStock('changePercent');

  return (
    <tr>
      <td>{symbol}</td>
      <td>{price != null ? `$${price.toFixed(2)}` : '—'}</td>
      <td style={{ color: getStock('isUp') ? 'green' : 'red' }}>
        {price != null ?
          <>
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)} ({pct.toFixed(2)}%)
          </>
        : '—'}
      </td>
    </tr>
  );
}

function AddSymbol() {
  const input = value('');
  const [text, setText] = input.use();

  const add = () => {
    const sym = text.trim().toUpperCase();
    if (!sym || watchlist.has(sym)) return;
    watchlist.set(sym, { symbol: sym });
    setText('');
  };

  return (
    <div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="AAPL"
      />
      <button onClick={add}>Add</button>
    </div>
  );
}

function MarketStatus() {
  const [isOpen] = isMarketOpen.use();
  return <div>{isOpen ? 'Market Open' : 'Market Closed'}</div>;
}
```

### Re-render boundaries

- `StockRow` re-renders only when its own stock data changes. AAPL's price
  ticking doesn't re-render the GOOGL row.
- `WatchlistTable` re-renders only when the key list changes (add/remove
  symbol), not on price updates.
- `MarketStatus` re-renders only when the market open/close status changes.

## Virtualized list

For large watchlists, combine with a virtualizer. Only visible rows mount, which
means only visible stocks have active WebSocket subscriptions:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualWatchlist() {
  const symbols = watchlist.useKeys();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: symbols.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  return (
    <div ref={parentRef} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <StockRow key={symbols[row.index]} symbol={symbols[row.index]} />
        ))}
      </div>
    </div>
  );
}
```

Scroll down — the async derivation runs and the WebSocket opens. Scroll past —
the instance becomes unused and `onCleanup` closes it. No `useEffect`, no
cleanup logic in the component. The model handles it.

## How this looks in Zustand

```ts
// Zustand — subscription logic lives in the component
function StockRow({ symbol }: { symbol: string }) {
  const price = useStore((s) => s.stocks[symbol]?.price ?? 0);
  const prevClose = useStore((s) => s.stocks[symbol]?.prevClose ?? 0);

  useEffect(() => {
    const ws = new WebSocket(`wss://feed.example.com/stocks/${symbol}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      useStore.getState().updateStock(symbol, data);
    };
    return () => ws.close();
  }, [symbol]);

  // ...render
}
```

The WebSocket lifecycle is now a React concern. It lives inside `useEffect`,
coupled to component mount/unmount. Testing it means rendering React components.
Reusing it outside React means extracting it into a separate system — which is
what ValUse gives you out of the box.

## How this looks in Jotai

```ts
// Jotai — atomFamily + useEffect for each subscription
const stockAtom = atomFamily((symbol: string) =>
  atom({ price: 0, prevClose: 0, volume: 0 }),
);

function StockRow({ symbol }: { symbol: string }) {
  const [stock, setStock] = useAtom(stockAtom(symbol));

  useEffect(() => {
    const ws = new WebSocket(`wss://feed.example.com/stocks/${symbol}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setStock((prev) => ({ ...prev, price: data.price, volume: data.volume }));
    };
    return () => ws.close();
  }, [symbol]);

  // ...render
}
```

Same problem: subscription logic in the view. Every component manages its own
cleanup.
