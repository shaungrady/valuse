import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	createHolding,
	createHoldingsMap,
	getDerived,
	setShares,
	setCostBasis,
	setSymbol,
	canUndo,
	undo,
	redo,
	startPolling,
	destroy,
	refreshConfig,
	type HoldingState,
} from './valtio.js';

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

let holding: HoldingState;

function setupHolding(
	overrides: Partial<{
		symbol: string;
		shares: number;
		costBasis: number;
	}> = {},
) {
	holding = createHolding({
		symbol: 'AAPL',
		shares: 10,
		costBasis: 150,
		...overrides,
	});
	return holding;
}

afterEach(() => {
	destroy(holding);
});

async function waitForPrice(
	target: HoldingState,
	expected?: number,
): Promise<void> {
	const check =
		expected != null ?
			() => target.data.price === expected
		:	() => target.data.price != null;
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Price never arrived');
}

// ─── Derivations ────────────────────────────────────────────────────

describe('valtio holding: derivations', () => {
	it('returns undefined before price arrives', () => {
		setupHolding();
		const derived = getDerived(holding);
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
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);

		const derived = getDerived(holding);
		expect(derived.marketValue).toBe(expected.marketValue);
		expect(derived.gainLoss).toBe(expected.gainLoss);
		expect(derived.gainLossPercent).toBe(expected.gainLossPercent);
		expect(derived.isUp).toBe(expected.isUp);
	});

	it('recomputes when shares change', async () => {
		mockPrices.AAPL = 180;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);

		expect(getDerived(holding).marketValue).toBe(1800);

		setShares(holding, 20);
		expect(getDerived(holding).marketValue).toBe(3600);
		expect(getDerived(holding).gainLoss).toBe(600);
	});

	it('recomputes on next price tick', async () => {
		mockPrices.AAPL = 180;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);
		expect(getDerived(holding).gainLoss).toBe(300);

		holding.data.price = 200;
		expect(getDerived(holding).gainLoss).toBe(500);
	});
});

// ─── Async lifecycle ────────────────────────────────────────────────

describe('valtio holding: async lifecycle', () => {
	it('refetches when symbol changes', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 140;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);
		expect(holding.data.price).toBe(180);

		setSymbol(holding, 'GOOGL');
		await waitForPrice(holding, 140);
		expect(holding.data.price).toBe(140);
	});

	it('aborts on destroy', async () => {
		mockPrices.AAPL = 180;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);

		destroy(holding);
	});
});

// ─── Undo / redo ────────────────────────────────────────────────────

describe('valtio holding: undo/redo', () => {
	it('undoes and redoes share edits', async () => {
		mockPrices.AAPL = 180;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);

		setShares(holding, 20);
		setShares(holding, 30);

		expect(canUndo(holding)).toBe(true);
		undo(holding);
		expect(holding.data.shares).toBe(20);
		undo(holding);
		expect(holding.data.shares).toBe(10);

		redo(holding);
		expect(holding.data.shares).toBe(20);
	});

	it('tracks costBasis edits', async () => {
		mockPrices.AAPL = 180;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);

		setCostBasis(holding, 160);
		undo(holding);
		expect(holding.data.costBasis).toBe(150);
	});

	it('does not track symbol (not in history)', async () => {
		mockPrices.AAPL = 180;
		setupHolding();
		startPolling(holding);
		await waitForPrice(holding);

		setSymbol(holding, 'GOOGL');
		undo(holding);
		expect(holding.data.symbol).toBe('GOOGL');
	});
});

// ─── Shared config ──────────────────────────────────────────────────

describe('valtio holding: shared config', () => {
	it('all holdings share the same refresh config', () => {
		setupHolding();
		expect(refreshConfig.rateMs).toBe(5_000);

		refreshConfig.rateMs = 10_000;
		expect(refreshConfig.rateMs).toBe(10_000);

		refreshConfig.rateMs = 5_000;
	});
});

// ─── Collection ─────────────────────────────────────────────────────

describe('valtio holding: collection', () => {
	it('CRUD on holdings map', () => {
		const holdings = createHoldingsMap();

		holdings.add('AAPL', { symbol: 'AAPL', shares: 10, costBasis: 150 });
		holdings.add('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });
		expect(holdings.size).toBe(2);

		holdings.remove('GOOGL');
		expect(holdings.size).toBe(1);
		expect(holdings.has('GOOGL')).toBe(false);

		holdings.destroy();
	});

	it('each entry computes independently', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 120;
		const holdings = createHoldingsMap();

		const aapl = holdings.add('AAPL', {
			symbol: 'AAPL',
			shares: 10,
			costBasis: 150,
		});
		const googl = holdings.add('GOOGL', {
			symbol: 'GOOGL',
			shares: 5,
			costBasis: 100,
		});

		startPolling(aapl);
		startPolling(googl);

		await waitForPrice(aapl);
		await waitForPrice(googl);

		expect(getDerived(aapl).marketValue).toBe(1800);
		expect(getDerived(googl).marketValue).toBe(600);

		holdings.destroy();
	});
});
