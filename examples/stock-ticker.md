# Example: Stock Ticker

A live stock price table where each row subscribes to real-time data only while
visible. This showcases lifecycle hooks — the feature that most state libraries
don't have.

## The problem

You have a watchlist of stock symbols. Each one needs a WebSocket subscription
for live prices. But you don't want to subscribe to all of them at once — only
the ones currently rendered. When a user scrolls a row out of view, or navigates
away, the subscription should stop. When they come back, it should resume.

In Zustand or Jotai, you'd wire this up with `useEffect` in each component. The
subscription logic lives in the view layer, tangled with React lifecycle. In
ValUse, it lives in the model.

## The model

```ts
import { value, valueRef, valueScope } from "valuse";

// Market status — shared across all tickers
const marketOpen = value<boolean>(false);

const stock = valueScope(
  {
    symbol: value<string>(),
    price: value<number>(0).compareUsing((a, b) => Math.abs(a - b) < 0.01), // ignore sub-penny noise
    prevClose: value<number>(0),
    high: value<number>(0),
    low: value<number>(0),
    volume: value<number>(0),
    ws: value<WebSocket | null>(null),

    // Ref to shared market status
    marketOpen: valueRef(marketOpen),

    // Derivations
    change: ({ use }) => use("price") - use("prevClose"),
    changePercent: ({ use }) => {
      const prev = use("prevClose");
      return prev === 0 ? 0 : ((use("price") - prev) / prev) * 100;
    },
    isUp: ({ use }) => use("change") >= 0,
    isTrading: ({ use }) => use("marketOpen") && use("price") > 0,
  },
  {
    onUsed: ({ set, get }) => {
      // First React component subscribed — open the WebSocket
      const symbol = get("symbol");
      const ws = new WebSocket(`wss://feed.example.com/stocks/${symbol}`);

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        set("price", data.price);
        set("high", (prev) => Math.max(prev, data.price));
        set("low", (prev) =>
          prev === 0 ? data.price : Math.min(prev, data.price),
        );
        set("volume", data.volume);
      };

      set("ws", ws);
    },

    onUnused: ({ get }) => {
      // Last subscriber gone — close the connection
      const ws = get("ws");
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    },

    onDestroy: ({ get }) => {
      // Removed from watchlist entirely — ensure cleanup
      const ws = get("ws");
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
    },
  },
);

// The watchlist
const watchlist = stock.createMap();
```

### What onUsed/onUnused give you

| Event                                                        | What happens                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Component mounts, calls `watchlist.use("AAPL")`              | `onUsed` fires, WebSocket opens                                 |
| Second component also subscribes to AAPL                     | Nothing — already connected (subscriber count goes from 1 to 2) |
| First component unmounts                                     | Nothing — still one subscriber                                  |
| Last component unmounts                                      | `onUnused` fires, WebSocket closes                              |
| User removes AAPL from watchlist: `watchlist.delete("AAPL")` | `onDestroy` fires, WebSocket closes                             |

This is **lazy resource management at the model level**. The view doesn't know
about WebSockets. The model doesn't know about React.

## React components

```tsx
import { value, valueScope } from "valuse/react";

function WatchlistTable() {
  const symbols = watchlist.useKeys();

  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Price</th>
          <th>Change</th>
          <th>Volume</th>
          <th>High</th>
          <th>Low</th>
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
  // This subscription triggers onUsed/onUnused automatically
  const [get] = watchlist.use(symbol);

  const changeStr = get("change").toFixed(2);
  const pctStr = get("changePercent").toFixed(2);

  return (
    <tr>
      <td>{symbol}</td>
      <td>${get("price").toFixed(2)}</td>
      <td style={{ color: get("isUp") ? "green" : "red" }}>
        {get("isUp") ? "+" : ""}
        {changeStr} ({pctStr}%)
      </td>
      <td>{get("volume").toLocaleString()}</td>
      <td>{get("high").toFixed(2)}</td>
      <td>{get("low").toFixed(2)}</td>
    </tr>
  );
}

function AddSymbol() {
  const input = value("");
  const [text, setText] = input.use();

  const add = () => {
    const sym = text.trim().toUpperCase();
    if (!sym || watchlist.has(sym)) return;
    watchlist.set(sym, { symbol: sym });
    setText("");
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
  const [isOpen] = marketOpen.use();
  return <div>{isOpen ? "Market Open" : "Market Closed"}</div>;
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
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualWatchlist() {
  const symbols = watchlist.useKeys();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: symbols.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  return (
    <div ref={parentRef} style={{ height: 400, overflow: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <StockRow key={symbols[row.index]} symbol={symbols[row.index]} />
        ))}
      </div>
    </div>
  );
}
```

Scroll down — `onUsed` fires and the WebSocket opens. Scroll past — `onUnused`
fires and it closes. No `useEffect`, no cleanup logic in the component. The
model handles it.

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

Same problem: subscription logic in the view. No concept of "this atom is being
watched by N subscribers" at the model level. No `onUsed`/`onUnused`. Every
component manages its own cleanup.
