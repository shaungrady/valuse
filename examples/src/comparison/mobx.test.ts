import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HoldingModel, HoldingsCollection, refreshConfig } from './mobx.js';

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

let holding: HoldingModel;

function createHolding(
	overrides: Partial<{
		symbol: string;
		shares: number;
		costBasis: number;
	}> = {},
) {
	holding = new HoldingModel({
		symbol: 'AAPL',
		shares: 10,
		costBasis: 150,
		...overrides,
	});
	return holding;
}

afterEach(() => {
	holding?.destroy();
});

async function waitForPrice(
	target: HoldingModel,
	expected?: number,
): Promise<void> {
	const check =
		expected != null ?
			() => target.price === expected
		:	() => target.price != null;
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Price never arrived');
}

// ─── Derivations ────────────────────────────────────────────────────

describe('mobx holding: derivations', () => {
	it('returns undefined before price arrives', () => {
		createHolding();
		expect(holding.marketValue).toBeUndefined();
		expect(holding.gainLoss).toBeUndefined();
		expect(holding.gainLossPercent).toBeUndefined();
		expect(holding.isUp).toBeUndefined();
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
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);

		expect(holding.marketValue).toBe(expected.marketValue);
		expect(holding.gainLoss).toBe(expected.gainLoss);
		expect(holding.gainLossPercent).toBe(expected.gainLossPercent);
		expect(holding.isUp).toBe(expected.isUp);
	});

	it('recomputes when shares change', async () => {
		mockPrices.AAPL = 180;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);

		expect(holding.marketValue).toBe(1800);

		holding.setShares(20);
		expect(holding.marketValue).toBe(3600);
		expect(holding.gainLoss).toBe(600);
	});

	it('recomputes on next price tick', async () => {
		mockPrices.AAPL = 180;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);
		expect(holding.gainLoss).toBe(300);

		mockPrices.AAPL = 200;
		holding.price = 200;
		expect(holding.gainLoss).toBe(500);
	});
});

// ─── Async lifecycle ────────────────────────────────────────────────

describe('mobx holding: async lifecycle', () => {
	it('refetches when symbol changes', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 140;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);
		expect(holding.price).toBe(180);

		holding.setSymbol('GOOGL');
		await waitForPrice(holding, 140);
		expect(holding.price).toBe(140);
	});

	it('aborts on destroy', async () => {
		mockPrices.AAPL = 180;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);

		holding.destroy();
	});
});

// ─── Undo / redo ────────────────────────────────────────────────────

describe('mobx holding: undo/redo', () => {
	it('undoes and redoes share edits', async () => {
		mockPrices.AAPL = 180;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);

		holding.setShares(20);
		holding.setShares(30);

		expect(holding.canUndo).toBe(true);
		holding.undo();
		expect(holding.shares).toBe(20);
		holding.undo();
		expect(holding.shares).toBe(10);

		holding.redo();
		expect(holding.shares).toBe(20);
	});

	it('tracks costBasis edits', async () => {
		mockPrices.AAPL = 180;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);

		holding.setCostBasis(160);
		holding.undo();
		expect(holding.costBasis).toBe(150);
	});

	it('does not track symbol (not in history)', async () => {
		mockPrices.AAPL = 180;
		createHolding();
		holding.startPolling();
		await waitForPrice(holding);

		holding.setSymbol('GOOGL');
		holding.undo();
		expect(holding.symbol).toBe('GOOGL');
	});
});

// ─── Shared config ──────────────────────────────────────────────────

describe('mobx holding: shared config', () => {
	it('all holdings share the same refresh config', () => {
		createHolding();
		expect(refreshConfig.rateMs).toBe(5_000);

		refreshConfig.setRate(10_000);
		expect(refreshConfig.rateMs).toBe(10_000);

		// Reset
		refreshConfig.setRate(5_000);
	});
});

// ─── Collection ─────────────────────────────────────────────────────

describe('mobx holding: collection', () => {
	let collection: HoldingsCollection;

	beforeEach(() => {
		collection = new HoldingsCollection();
	});

	afterEach(() => {
		collection.destroy();
	});

	it('CRUD on holdings map', () => {
		collection.add('AAPL', { symbol: 'AAPL', shares: 10, costBasis: 150 });
		collection.add('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });
		expect(collection.size).toBe(2);

		collection.remove('GOOGL');
		expect(collection.size).toBe(1);
		expect(collection.has('GOOGL')).toBe(false);
	});

	it('each entry computes independently', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 120;

		const aapl = collection.add('AAPL', {
			symbol: 'AAPL',
			shares: 10,
			costBasis: 150,
		});
		const googl = collection.add('GOOGL', {
			symbol: 'GOOGL',
			shares: 5,
			costBasis: 100,
		});

		aapl.startPolling();
		googl.startPolling();

		await waitForPrice(aapl);
		await waitForPrice(googl);

		expect(aapl.marketValue).toBe(1800);
		expect(googl.marketValue).toBe(600);
	});
});
