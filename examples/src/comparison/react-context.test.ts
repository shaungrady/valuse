import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	portfolioReducer,
	initialState,
	getDerived,
	startPolling,
	type PortfolioState,
	type PortfolioAction,
} from './react-context.js';

// ─── Fetch mock ─────────────────────────────────────────────────────

const mockPrices: Record<string, number> = {};

beforeEach(() => {
	for (const key of Object.keys(mockPrices)) delete mockPrices[key];

	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			if (init?.signal?.aborted)
				throw new DOMException('Aborted', 'AbortError');
			const symbol = String(input).split('/').pop()!;
			return {
				json: () => Promise.resolve({ price: mockPrices[symbol] ?? 0 }),
			};
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ─── Helpers ────────────────────────────────────────────────────────
// Simulate useReducer outside of React.

let state: PortfolioState;

function dispatch(action: PortfolioAction) {
	state = portfolioReducer(state, action);
}

function getState() {
	return state;
}

const controllers: AbortController[] = [];

beforeEach(() => {
	state = { ...initialState, holdings: {}, past: [], future: [] };
});

afterEach(() => {
	for (const controller of controllers) controller.abort();
	controllers.length = 0;
});

function addHolding(
	key: string,
	overrides: Partial<{
		symbol: string;
		shares: number;
		costBasis: number;
	}> = {},
) {
	const init = { symbol: key, shares: 10, costBasis: 150, ...overrides };
	dispatch({ type: 'ADD_HOLDING', key, init });
	const controller = startPolling(getState, dispatch, key);
	controllers.push(controller);
	return controller;
}

async function waitForPrice(key: string, expected?: number): Promise<void> {
	const check =
		expected != null ?
			() => state.holdings[key]?.price === expected
		:	() => state.holdings[key]?.price != null;
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Price never arrived');
}

// ─── Derivations ────────────────────────────────────────────────────

describe('react-context holding: derivations', () => {
	it('returns undefined before price arrives', () => {
		dispatch({
			type: 'ADD_HOLDING',
			key: 'AAPL',
			init: { symbol: 'AAPL', shares: 10, costBasis: 150 },
		});
		const derived = getDerived(state.holdings.AAPL!);
		expect(derived.marketValue).toBeUndefined();
		expect(derived.gainLoss).toBeUndefined();
		expect(derived.gainLossPercent).toBeUndefined();
		expect(derived.isUp).toBeUndefined();
	});

	it.each([
		{
			scenario: 'gain',
			price: 180,
			expected: {
				marketValue: 1800,
				gainLoss: 300,
				gainLossPercent: 20,
				isUp: true,
			},
		},
		{
			scenario: 'loss',
			price: 120,
			expected: {
				marketValue: 1200,
				gainLoss: -300,
				gainLossPercent: -20,
				isUp: false,
			},
		},
		{
			scenario: 'flat',
			price: 150,
			expected: {
				marketValue: 1500,
				gainLoss: 0,
				gainLossPercent: 0,
				isUp: true,
			},
		},
	])('$scenario', async ({ price, expected }) => {
		mockPrices.AAPL = price;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		const derived = getDerived(state.holdings.AAPL!);
		expect(derived.marketValue).toBe(expected.marketValue);
		expect(derived.gainLoss).toBe(expected.gainLoss);
		expect(derived.gainLossPercent).toBe(expected.gainLossPercent);
		expect(derived.isUp).toBe(expected.isUp);
	});

	it('recomputes when shares change', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		expect(getDerived(state.holdings.AAPL!).marketValue).toBe(1800);

		dispatch({ type: 'SET_SHARES', key: 'AAPL', shares: 20 });
		expect(getDerived(state.holdings.AAPL!).marketValue).toBe(3600);
		expect(getDerived(state.holdings.AAPL!).gainLoss).toBe(600);
	});

	it('recomputes on next price tick', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');
		expect(getDerived(state.holdings.AAPL!).gainLoss).toBe(300);

		dispatch({ type: 'SET_PRICE', key: 'AAPL', price: 200 });
		expect(getDerived(state.holdings.AAPL!).gainLoss).toBe(500);
	});
});

// ─── Async lifecycle ────────────────────────────────────────────────

describe('react-context holding: async lifecycle', () => {
	it('refetches when symbol changes', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 140;
		const controller = addHolding('AAPL');
		await waitForPrice('AAPL');
		expect(state.holdings.AAPL?.price).toBe(180);

		// Must manually abort, change symbol, and restart polling
		controller.abort();
		dispatch({ type: 'SET_SYMBOL', key: 'AAPL', symbol: 'GOOGL' });
		const newController = startPolling(getState, dispatch, 'AAPL');
		controllers.push(newController);
		await waitForPrice('AAPL', 140);
		expect(state.holdings.AAPL?.price).toBe(140);
	});

	it('aborts on destroy', async () => {
		mockPrices.AAPL = 180;
		const controller = addHolding('AAPL');
		await waitForPrice('AAPL');

		controller.abort();
	});
});

// ─── Undo / redo ────────────────────────────────────────────────────

describe('react-context holding: undo/redo', () => {
	it('undoes and redoes share edits', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		dispatch({ type: 'SET_SHARES', key: 'AAPL', shares: 20 });
		dispatch({ type: 'SET_SHARES', key: 'AAPL', shares: 30 });

		expect(state.past.length > 0).toBe(true);
		dispatch({ type: 'UNDO' });
		expect(state.holdings.AAPL?.shares).toBe(20);
		dispatch({ type: 'UNDO' });
		expect(state.holdings.AAPL?.shares).toBe(10);

		dispatch({ type: 'REDO' });
		expect(state.holdings.AAPL?.shares).toBe(20);
	});

	it('tracks costBasis edits', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		dispatch({ type: 'SET_COST_BASIS', key: 'AAPL', costBasis: 160 });
		dispatch({ type: 'UNDO' });
		expect(state.holdings.AAPL?.costBasis).toBe(150);
	});

	it('does not track symbol (not in history)', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		dispatch({ type: 'SET_SYMBOL', key: 'AAPL', symbol: 'GOOGL' });
		dispatch({ type: 'UNDO' });
		// Symbol change doesn't push history, so undo has no effect on it
		expect(state.holdings.AAPL?.symbol).toBe('GOOGL');
	});
});

// ─── Shared config ──────────────────────────────────────────────────

describe('react-context holding: shared config', () => {
	it('all holdings share the same refresh rate', () => {
		expect(state.refreshRateMs).toBe(5_000);

		dispatch({ type: 'SET_REFRESH_RATE', rateMs: 10_000 });
		expect(state.refreshRateMs).toBe(10_000);

		dispatch({ type: 'SET_REFRESH_RATE', rateMs: 5_000 });
	});
});

// ─── Collection ─────────────────────────────────────────────────────

describe('react-context holding: collection', () => {
	it('CRUD on holdings record', () => {
		dispatch({
			type: 'ADD_HOLDING',
			key: 'AAPL',
			init: { symbol: 'AAPL', shares: 10, costBasis: 150 },
		});
		dispatch({
			type: 'ADD_HOLDING',
			key: 'GOOGL',
			init: { symbol: 'GOOGL', shares: 5, costBasis: 100 },
		});
		expect(Object.keys(state.holdings)).toHaveLength(2);

		dispatch({ type: 'REMOVE_HOLDING', key: 'GOOGL' });
		expect(Object.keys(state.holdings)).toHaveLength(1);
		expect(state.holdings.GOOGL).toBeUndefined();
	});

	it('each entry computes independently', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 120;
		addHolding('AAPL');
		addHolding('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });

		await waitForPrice('AAPL');
		await waitForPrice('GOOGL');

		expect(getDerived(state.holdings.AAPL!).marketValue).toBe(1800);
		expect(getDerived(state.holdings.GOOGL!).marketValue).toBe(600);
	});
});
