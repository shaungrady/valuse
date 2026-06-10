import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPortfolioStore, type PortfolioState } from './zustand.js';
import type { StoreApi } from 'zustand';

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

let store: StoreApi<PortfolioState>;

beforeEach(() => {
	store = createPortfolioStore();
});

afterEach(() => {
	store.getState().destroy();
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
	store.getState().addHolding(key, init);
	store.getState().startPolling(key);
}

async function waitForPrice(key: string, expected?: number): Promise<void> {
	const check =
		expected != null ?
			() => store.getState().holdings[key]?.price === expected
		:	() => store.getState().holdings[key]?.price != null;
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Price never arrived');
}

// ─── Derivations ────────────────────────────────────────────────────

describe('zustand holding: derivations', () => {
	it('returns undefined before price arrives', () => {
		store
			.getState()
			.addHolding('AAPL', { symbol: 'AAPL', shares: 10, costBasis: 150 });
		const derived = store.getState().getDerived('AAPL');
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

		const derived = store.getState().getDerived('AAPL');
		expect(derived.marketValue).toBe(expected.marketValue);
		expect(derived.gainLoss).toBe(expected.gainLoss);
		expect(derived.gainLossPercent).toBe(expected.gainLossPercent);
		expect(derived.isUp).toBe(expected.isUp);
	});

	it('recomputes when shares change', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		expect(store.getState().getDerived('AAPL').marketValue).toBe(1800);

		store.getState().setShares('AAPL', 20);
		expect(store.getState().getDerived('AAPL').marketValue).toBe(3600);
		expect(store.getState().getDerived('AAPL').gainLoss).toBe(600);
	});

	it('recomputes on next price tick', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');
		expect(store.getState().getDerived('AAPL').gainLoss).toBe(300);

		mockPrices.AAPL = 200;
		store.getState().setPrice('AAPL', 200);
		expect(store.getState().getDerived('AAPL').gainLoss).toBe(500);
	});
});

// ─── Async lifecycle ────────────────────────────────────────────────

describe('zustand holding: async lifecycle', () => {
	it('refetches when symbol changes', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 140;
		addHolding('AAPL');
		await waitForPrice('AAPL');
		expect(store.getState().holdings.AAPL?.price).toBe(180);

		store.getState().setSymbol('AAPL', 'GOOGL');
		await waitForPrice('AAPL', 140);
		expect(store.getState().holdings.AAPL?.price).toBe(140);
	});

	it('aborts on destroy', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		store.getState().destroy();
	});
});

// ─── Undo / redo ────────────────────────────────────────────────────

describe('zustand holding: undo/redo', () => {
	it('undoes and redoes share edits', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		store.getState().setShares('AAPL', 20);
		store.getState().setShares('AAPL', 30);

		expect(store.getState().canUndo()).toBe(true);
		store.getState().undo();
		expect(store.getState().holdings.AAPL?.shares).toBe(20);
		store.getState().undo();
		expect(store.getState().holdings.AAPL?.shares).toBe(10);

		store.getState().redo();
		expect(store.getState().holdings.AAPL?.shares).toBe(20);
	});

	it('tracks costBasis edits', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		store.getState().setCostBasis('AAPL', 160);
		store.getState().undo();
		expect(store.getState().holdings.AAPL?.costBasis).toBe(150);
	});

	it('does not track symbol (not in history)', async () => {
		mockPrices.AAPL = 180;
		addHolding('AAPL');
		await waitForPrice('AAPL');

		store.getState().setSymbol('AAPL', 'GOOGL');
		store.getState().undo();
		// Symbol change doesn't push history, so undo has no effect
		expect(store.getState().holdings.AAPL?.symbol).toBe('GOOGL');
	});
});

// ─── Shared config ──────────────────────────────────────────────────

describe('zustand holding: shared config', () => {
	it('all holdings share the same refresh rate', () => {
		addHolding('AAPL');
		expect(store.getState().refreshRateMs).toBe(5_000);

		store.getState().setRefreshRate(10_000);
		expect(store.getState().refreshRateMs).toBe(10_000);
	});
});

// ─── Collection ─────────────────────────────────────────────────────

describe('zustand holding: collection', () => {
	it('CRUD on holdings map', () => {
		store
			.getState()
			.addHolding('AAPL', { symbol: 'AAPL', shares: 10, costBasis: 150 });
		store
			.getState()
			.addHolding('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });
		expect(Object.keys(store.getState().holdings)).toHaveLength(2);

		store.getState().removeHolding('GOOGL');
		expect(Object.keys(store.getState().holdings)).toHaveLength(1);
		expect(store.getState().holdings.GOOGL).toBeUndefined();
	});

	it('each entry computes independently', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 120;
		addHolding('AAPL');
		addHolding('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });

		await waitForPrice('AAPL');
		await waitForPrice('GOOGL');

		expect(store.getState().getDerived('AAPL').marketValue).toBe(1800);
		expect(store.getState().getDerived('GOOGL').marketValue).toBe(600);
	});
});
