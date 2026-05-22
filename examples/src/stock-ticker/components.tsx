import { useState } from 'react';
import 'valuse/react';
import { isMarketOpen, watchlist } from './model.js';

type Watchlist = typeof watchlist;
type StockInstance = NonNullable<ReturnType<Watchlist['get']>>;

export function WatchlistTable() {
	const symbols = watchlist.useKeys();

	return (
		<table>
			<thead>
				<tr>
					<th scope="col">Symbol</th>
					<th scope="col">Price</th>
					<th scope="col">Change</th>
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

export function StockRow({ symbol }: { symbol: string }) {
	const stock = watchlist.get(symbol) as StockInstance | undefined;
	if (!stock) return null;

	// `useAsync()` returns [value, AsyncState]. We use the AsyncState to
	// distinguish "connecting" (no price yet) from "live" and "errored".
	const [price, priceState] = stock.price.useAsync();
	const [change] = stock.change.use();
	const [changePercent] = stock.changePercent.use();
	const [isUp] = stock.isUp.use();

	// Streaming async derivations (no return, just `set()`) resolve their
	// promise to `undefined` immediately, so status flips from 'setting' to
	// 'unset' before the first stream message arrives. Use `hasValue` as the
	// "is there a value yet?" gate; status is informative for error display.
	const isConnecting = !priceState.hasValue && priceState.status !== 'error';
	const isErrored = priceState.status === 'error';

	return (
		<tr aria-label={`Row ${symbol}`}>
			<td>
				{symbol}
				{isErrored && <span aria-label={`${symbol} error`}>reconnecting…</span>}
			</td>
			<td aria-label={`${symbol} price`}>
				{isConnecting ?
					'connecting…'
				: price != null ?
					`$${(price as number).toFixed(2)}`
				:	'—'}
			</td>
			<td aria-label={`${symbol} change`} data-direction={isUp ? 'up' : 'down'}>
				{price != null ?
					`${(change as number) >= 0 ? '+' : ''}${(change as number).toFixed(
						2,
					)} (${(changePercent as number).toFixed(2)}%)`
				:	'—'}
			</td>
		</tr>
	);
}

export function AddSymbol() {
	const [text, setText] = useState('');

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
				aria-label="New symbol"
			/>
			<button onClick={add}>Add</button>
		</div>
	);
}

export function MarketStatus() {
	const [isOpen] = isMarketOpen.use();
	return (
		<div aria-label="Market status">
			{isOpen ? 'Market Open' : 'Market Closed'}
		</div>
	);
}
