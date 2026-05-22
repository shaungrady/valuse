import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	render,
	screen,
	fireEvent,
	act,
	waitFor,
} from '@testing-library/react';
import {
	isMarketOpen,
	setPriceStreamFactory,
	stockScope,
	watchlist,
	type PriceStream,
} from './model.js';
import {
	AddSymbol,
	MarketStatus,
	StockRow,
	WatchlistTable,
} from './components.js';

// ── Fake price-stream factory ────────────────────────────────────────
// Tests build streams via `makeStream()` and emit prices imperatively.
type Emit = (price: number) => void;

interface FakeStream extends PriceStream {
	emit: Emit;
	closed: boolean;
}

const streams = new Map<string, FakeStream>();

function makeStream(symbol: string): FakeStream {
	let emit: Emit = () => undefined;
	const stream: FakeStream = {
		emit: (price) => emit(price),
		closed: false,
		subscribe(onPrice) {
			emit = onPrice;
			return () => {
				stream.closed = true;
				emit = () => undefined;
			};
		},
	};
	streams.set(symbol, stream);
	return stream;
}

beforeEach(() => {
	streams.clear();
	setPriceStreamFactory((symbol) => makeStream(symbol));
	// Reset shared state.
	isMarketOpen.set(false);
	for (const key of [...watchlist.keys()]) watchlist.delete(key);
});

afterEach(() => {
	setPriceStreamFactory(null);
});

describe('stock-ticker: stockScope', () => {
	it('opens a price stream when the instance is created', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));
	});

	it('price updates via set() flow into the field', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));

		act(() => streams.get('AAPL')!.emit(190));
		const stock = watchlist.get('AAPL')!;
		expect(stock.price.get()).toBe(190);
	});

	it('change + changePercent derive from price and prevClose', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 100 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));
		act(() => streams.get('AAPL')!.emit(110));
		const stock = watchlist.get('AAPL')!;
		expect(stock.change.get()).toBe(10);
		expect(stock.changePercent.get()).toBe(10);
		expect(stock.isUp.get()).toBe(true);
	});

	it('change is 0 when price is unset (initial)', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 100 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));
		expect(watchlist.get('AAPL')!.change.get()).toBe(0);
	});

	it('changing symbol on an existing instance closes the old stream', async () => {
		const inst = stockScope.create({ symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));

		inst.symbol.set('GOOGL');
		await waitFor(() => expect(streams.get('AAPL')!.closed).toBe(true));
		await waitFor(() => expect(streams.has('GOOGL')).toBe(true));
		expect(streams.get('GOOGL')!.closed).toBe(false);
	});

	it('isTrading combines shared isMarketOpen with price availability', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));
		const stock = watchlist.get('AAPL')!;
		expect(stock.isTrading.get()).toBe(false); // market closed
		isMarketOpen.set(true);
		expect(stock.isTrading.get()).toBe(false); // no price yet
		act(() => streams.get('AAPL')!.emit(180));
		expect(stock.isTrading.get()).toBe(true); // both conditions met
	});

	it('destroying the instance closes the stream', async () => {
		const inst = stockScope.create({ symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));
		inst.$destroy();
		await waitFor(() => expect(streams.get('AAPL')!.closed).toBe(true));
	});
});

describe('stock-ticker: WatchlistTable', () => {
	it('renders a row per watchlist entry, updates on add/remove', () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 180 });
		render(<WatchlistTable />);
		expect(screen.getByLabelText('Row AAPL')).toBeDefined();

		act(() => {
			watchlist.set('GOOGL', { symbol: 'GOOGL', prevClose: 150 });
		});
		expect(screen.getByLabelText('Row GOOGL')).toBeDefined();

		act(() => {
			watchlist.delete('AAPL');
		});
		expect(screen.queryByLabelText('Row AAPL')).toBeNull();
	});
});

describe('stock-ticker: StockRow', () => {
	it('shows "connecting…" until the first price arrives', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));

		render(<StockRow symbol="AAPL" />);
		expect(screen.getByLabelText('AAPL price').textContent).toBe('connecting…');

		act(() => streams.get('AAPL')!.emit(180));
		await waitFor(() =>
			expect(screen.getByLabelText('AAPL price').textContent).toBe('$180.00'),
		);
	});

	it('change cell reflects positive/negative direction', async () => {
		watchlist.set('AAPL', { symbol: 'AAPL', prevClose: 180 });
		await waitFor(() => expect(streams.has('AAPL')).toBe(true));

		render(<StockRow symbol="AAPL" />);
		act(() => streams.get('AAPL')!.emit(190));
		await waitFor(() => {
			const cell = screen.getByLabelText('AAPL change');
			expect(cell.getAttribute('data-direction')).toBe('up');
			expect(cell.textContent).toContain('+10.00');
		});

		act(() => streams.get('AAPL')!.emit(170));
		await waitFor(() => {
			const cell = screen.getByLabelText('AAPL change');
			expect(cell.getAttribute('data-direction')).toBe('down');
			expect(cell.textContent).toContain('-10.00');
		});
	});
});

describe('stock-ticker: AddSymbol', () => {
	it('typing a symbol + Add inserts into the watchlist (uppercased) and clears input', () => {
		render(<AddSymbol />);
		const input = screen.getByLabelText('New symbol') as HTMLInputElement;

		fireEvent.change(input, { target: { value: 'aapl' } });
		fireEvent.click(screen.getByText('Add'));

		expect(watchlist.has('AAPL')).toBe(true);
		expect(input.value).toBe('');
	});

	it('ignores duplicates', () => {
		watchlist.set('AAPL', { symbol: 'AAPL' });
		render(<AddSymbol />);
		fireEvent.change(screen.getByLabelText('New symbol'), {
			target: { value: 'AAPL' },
		});
		fireEvent.click(screen.getByText('Add'));
		expect(watchlist.size).toBe(1);
	});

	it('ignores blank input', () => {
		render(<AddSymbol />);
		fireEvent.click(screen.getByText('Add'));
		expect(watchlist.size).toBe(0);
	});
});

describe('stock-ticker: MarketStatus', () => {
	it('reflects the shared isMarketOpen Value reactively', () => {
		render(<MarketStatus />);
		expect(screen.getByLabelText('Market status').textContent).toBe(
			'Market Closed',
		);
		act(() => isMarketOpen.set(true));
		expect(screen.getByLabelText('Market status').textContent).toBe(
			'Market Open',
		);
	});
});
