import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'jotai';
import {
	refreshRateMsAtom,
	createHoldingAtoms,
	createHoldingHistory,
	setShares,
	setCostBasis,
	setSymbol,
	undoHolding,
	redoHolding,
	startPolling,
	type HoldingAtoms,
	type HoldingHistory,
} from './jotai.js';

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

let store: ReturnType<typeof createStore>;
let atoms: HoldingAtoms;
let history: HoldingHistory;
let controller: AbortController | undefined;

function setupHolding(
	overrides: Partial<{
		symbol: string;
		shares: number;
		costBasis: number;
	}> = {},
) {
	atoms = createHoldingAtoms({
		symbol: 'AAPL',
		shares: 10,
		costBasis: 150,
		...overrides,
	});
	history = createHoldingHistory();
}

beforeEach(() => {
	store = createStore();
	setupHolding();
});

afterEach(() => {
	controller?.abort();
	controller = undefined;
});

function startFetching() {
	controller = startPolling(store, atoms);
}

async function waitForPrice(expected?: number): Promise<void> {
	const check =
		expected != null ?
			() => store.get(atoms.price) === expected
		:	() => store.get(atoms.price) != null;
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Price never arrived');
}

// ─── Derivations ────────────────────────────────────────────────────

describe('jotai holding: derivations', () => {
	it('returns undefined before price arrives', () => {
		expect(store.get(atoms.marketValue)).toBeUndefined();
		expect(store.get(atoms.gainLoss)).toBeUndefined();
		expect(store.get(atoms.gainLossPercent)).toBeUndefined();
		expect(store.get(atoms.isUp)).toBeUndefined();
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
		startFetching();
		await waitForPrice();

		expect(store.get(atoms.marketValue)).toBe(expected.marketValue);
		expect(store.get(atoms.gainLoss)).toBe(expected.gainLoss);
		expect(store.get(atoms.gainLossPercent)).toBe(expected.gainLossPercent);
		expect(store.get(atoms.isUp)).toBe(expected.isUp);
	});

	it('recomputes when shares change', async () => {
		mockPrices.AAPL = 180;
		startFetching();
		await waitForPrice();

		expect(store.get(atoms.marketValue)).toBe(1800);

		setShares(store, atoms, history, 20);
		expect(store.get(atoms.marketValue)).toBe(3600);
		expect(store.get(atoms.gainLoss)).toBe(600);
	});

	it('recomputes on next price tick', async () => {
		mockPrices.AAPL = 180;
		startFetching();
		await waitForPrice();
		expect(store.get(atoms.gainLoss)).toBe(300);

		store.set(atoms.price, 200);
		expect(store.get(atoms.gainLoss)).toBe(500);
	});
});

// ─── Async lifecycle ────────────────────────────────────────────────

describe('jotai holding: async lifecycle', () => {
	it('refetches when symbol changes', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 140;
		startFetching();
		await waitForPrice();
		expect(store.get(atoms.price)).toBe(180);

		// Must manually stop + restart polling on symbol change
		controller!.abort();
		setSymbol(store, atoms, 'GOOGL');
		startFetching();
		await waitForPrice(140);
		expect(store.get(atoms.price)).toBe(140);
	});

	it('aborts on destroy', async () => {
		mockPrices.AAPL = 180;
		startFetching();
		await waitForPrice();

		controller!.abort();
	});
});

// ─── Undo / redo ────────────────────────────────────────────────────

describe('jotai holding: undo/redo', () => {
	it('undoes and redoes share edits', async () => {
		mockPrices.AAPL = 180;
		startFetching();
		await waitForPrice();

		setShares(store, atoms, history, 20);
		setShares(store, atoms, history, 30);

		expect(history.past.length > 0).toBe(true);
		undoHolding(store, atoms, history);
		expect(store.get(atoms.shares)).toBe(20);
		undoHolding(store, atoms, history);
		expect(store.get(atoms.shares)).toBe(10);

		redoHolding(store, atoms, history);
		expect(store.get(atoms.shares)).toBe(20);
	});

	it('tracks costBasis edits', async () => {
		mockPrices.AAPL = 180;
		startFetching();
		await waitForPrice();

		setCostBasis(store, atoms, history, 160);
		undoHolding(store, atoms, history);
		expect(store.get(atoms.costBasis)).toBe(150);
	});

	it('does not track symbol (not in history snapshot)', async () => {
		mockPrices.AAPL = 180;
		startFetching();
		await waitForPrice();

		setSymbol(store, atoms, 'GOOGL');
		// setSymbol doesn't push history, so undo has no effect on it
		undoHolding(store, atoms, history);
		expect(store.get(atoms.symbol)).toBe('GOOGL');
	});
});

// ─── Shared config ──────────────────────────────────────────────────

describe('jotai holding: shared config', () => {
	it('all holdings share the same refresh rate atom', () => {
		expect(store.get(refreshRateMsAtom)).toBe(5_000);

		store.set(refreshRateMsAtom, 10_000);
		expect(store.get(refreshRateMsAtom)).toBe(10_000);

		store.set(refreshRateMsAtom, 5_000);
	});
});

// ─── Collection ─────────────────────────────────────────────────────

describe('jotai holding: collection', () => {
	it('CRUD on a holdings map', () => {
		const holdings = new Map<string, HoldingAtoms>();

		holdings.set(
			'AAPL',
			createHoldingAtoms({ symbol: 'AAPL', shares: 10, costBasis: 150 }),
		);
		holdings.set(
			'GOOGL',
			createHoldingAtoms({ symbol: 'GOOGL', shares: 5, costBasis: 100 }),
		);
		expect(holdings.size).toBe(2);

		holdings.delete('GOOGL');
		expect(holdings.size).toBe(1);
		expect(holdings.has('GOOGL')).toBe(false);
	});

	it('each entry computes independently', async () => {
		mockPrices.AAPL = 180;
		mockPrices.GOOGL = 120;

		const aaplAtoms = createHoldingAtoms({
			symbol: 'AAPL',
			shares: 10,
			costBasis: 150,
		});
		const googlAtoms = createHoldingAtoms({
			symbol: 'GOOGL',
			shares: 5,
			costBasis: 100,
		});

		const aaplController = startPolling(store, aaplAtoms);
		const googlController = startPolling(store, googlAtoms);

		for (let i = 0; i < 50; i++) {
			if (
				store.get(aaplAtoms.price) != null &&
				store.get(googlAtoms.price) != null
			)
				break;
			await new Promise((r) => setTimeout(r, 5));
		}

		expect(store.get(aaplAtoms.marketValue)).toBe(1800);
		expect(store.get(googlAtoms.marketValue)).toBe(600);

		aaplController.abort();
		googlController.abort();
	});
});
