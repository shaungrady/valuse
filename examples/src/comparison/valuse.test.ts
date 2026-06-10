import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { holdingScope, refreshRateMs } from './valuse.js';

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

function createHolding(
	overrides: Partial<{
		symbol: string;
		shares: number;
		costBasis: number;
	}> = {},
) {
	return holdingScope.create({
		symbol: 'AAPL',
		shares: 10,
		costBasis: 150,
		...overrides,
	});
}

async function waitForPrice(
	holding: { price: { get(): number | undefined } },
	expected?: number,
): Promise<void> {
	const check =
		expected != null ?
			() => holding.price.get() === expected
		:	() => holding.price.get() != null;
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Price never arrived');
}

// ─── Derivations ────────────────────────────────────────────────────

describe('holding: derivations', () => {
	it('returns undefined before price arrives', () => {
		const holding = createHolding();
		expect(holding.marketValue.get()).toBeUndefined();
		expect(holding.gainLoss.get()).toBeUndefined();
		expect(holding.gainLossPercent.get()).toBeUndefined();
		expect(holding.isUp.get()).toBeUndefined();
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
		const holding = createHolding();
		await waitForPrice(holding);

		expect(holding.marketValue.get()).toBe(expected.marketValue);
		expect(holding.gainLoss.get()).toBe(expected.gainLoss);
		expect(holding.gainLossPercent.get()).toBe(expected.gainLossPercent);
		expect(holding.isUp.get()).toBe(expected.isUp);
	});

	it('recomputes when shares change', async () => {
		mockPrices.AAPL = 180;
		const holding = createHolding();
		await waitForPrice(holding);

		expect(holding.marketValue.get()).toBe(1800);

		holding.shares.set(20);
		expect(holding.marketValue.get()).toBe(3600);
		expect(holding.gainLoss.get()).toBe(600);
	});

	it('recomputes on next price tick', async () => {
		mockPrices.AAPL = 180;
		const holding = createHolding();
		await waitForPrice(holding);
		expect(holding.gainLoss.get()).toBe(300);

		mockPrices.AAPL = 200;
		await holding.price.flush();
		expect(holding.gainLoss.get()).toBe(500);
	});
});

// ─── Async lifecycle ────────────────────────────────────────────────

describe('holding: async lifecycle', () => {
	it('refetches when symbol changes', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 140;
		const holding = createHolding();
		await waitForPrice(holding);
		expect(holding.price.get()).toBe(180);

		holding.symbol.set('GOOGL');
		await waitForPrice(holding, 140);
		expect(holding.price.get()).toBe(140);
	});

	it('aborts on destroy', async () => {
		mockPrices.AAPL = 180;
		const holding = createHolding();
		await waitForPrice(holding);

		holding.$destroy();
		// No assertion needed — if abort fails, the poll loop would throw
		// on the next fetch after the test's mock is torn down.
	});
});

// ─── Undo / redo ────────────────────────────────────────────────────

describe('holding: undo/redo', () => {
	it('undoes and redoes share edits', async () => {
		const holding = createHolding();
		await waitForPrice(holding);

		holding.shares.set(20);
		holding.shares.set(30);

		expect(holding.$canUndo).toBe(true);
		holding.$undo();
		expect(holding.shares.get()).toBe(20);
		holding.$undo();
		expect(holding.shares.get()).toBe(10);

		holding.$redo();
		expect(holding.shares.get()).toBe(20);
	});

	it('tracks costBasis edits', async () => {
		const holding = createHolding();
		await waitForPrice(holding);

		holding.costBasis.set(160);
		holding.$undo();
		expect(holding.costBasis.get()).toBe(150);
	});

	it('does not track symbol (not in history fields list)', async () => {
		const holding = createHolding();
		await waitForPrice(holding);

		holding.symbol.set('GOOGL');
		holding.$undo();
		expect(holding.symbol.get()).toBe('GOOGL');
	});
});

// ─── Shared config via valueRef ─────────────────────────────────────

describe('holding: shared config', () => {
	it('every instance reads the same refreshRate ref', () => {
		const holding = createHolding();
		// The instance's refreshRate field IS the shared Value, not a copy.
		expect(holding.refreshRate.get()).toBe(refreshRateMs.get());

		refreshRateMs.set(10_000);
		expect(holding.refreshRate.get()).toBe(10_000);

		// Reset so other tests aren't affected.
		refreshRateMs.set(5_000);
	});
});

// ─── ScopeMap collection ────────────────────────────────────────────

describe('holding: ScopeMap', () => {
	it('CRUD on a keyed collection', () => {
		const holdings = holdingScope.createMap();

		holdings.set('AAPL', { symbol: 'AAPL', shares: 10, costBasis: 150 });
		holdings.set('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });
		expect(holdings.size).toBe(2);

		holdings.delete('GOOGL');
		expect(holdings.size).toBe(1);
		expect(holdings.has('GOOGL')).toBe(false);
	});

	it('each entry is an independent reactive instance', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 120;
		const holdings = holdingScope.createMap();

		holdings.set('AAPL', { symbol: 'AAPL', shares: 10, costBasis: 150 });
		holdings.set('GOOGL', { symbol: 'GOOGL', shares: 5, costBasis: 100 });

		await waitForPrice(holdings.get('AAPL')!);
		await waitForPrice(holdings.get('GOOGL')!);

		expect(holdings.get('AAPL')!.marketValue.get()).toBe(1800);
		expect(holdings.get('GOOGL')!.marketValue.get()).toBe(600);
	});
});
