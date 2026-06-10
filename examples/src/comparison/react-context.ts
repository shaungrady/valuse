/**
 * Stock portfolio — React Context comparison example.
 *
 * The "no library" baseline: useReducer for state, plain functions for
 * derived values, manual AbortController for async, and a hand-rolled
 * history stack for undo/redo. Every context consumer re-renders on any
 * state change (no per-field subscriptions). Action types grow linearly
 * with operations.
 *
 * Since this comparison tests pure logic (no React rendering), we use
 * the reducer directly without createContext/useReducer wrappers.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface Holding {
	symbol: string;
	shares: number;
	costBasis: number;
	price: number | undefined;
}

export interface HoldingDerived {
	marketValue: number | undefined;
	gainLoss: number | undefined;
	gainLossPercent: number | undefined;
	isUp: boolean | undefined;
}

interface HistorySnapshot {
	holdings: Record<string, Holding>;
}

export interface PortfolioState {
	refreshRateMs: number;
	holdings: Record<string, Holding>;
	past: HistorySnapshot[];
	future: HistorySnapshot[];
}

// ── Actions (one type per operation) ────────────────────────────────

export type PortfolioAction =
	| { type: 'ADD_HOLDING'; key: string; init: Omit<Holding, 'price'> }
	| { type: 'REMOVE_HOLDING'; key: string }
	| { type: 'SET_SHARES'; key: string; shares: number }
	| { type: 'SET_COST_BASIS'; key: string; costBasis: number }
	| { type: 'SET_SYMBOL'; key: string; symbol: string }
	| { type: 'SET_PRICE'; key: string; price: number }
	| { type: 'SET_REFRESH_RATE'; rateMs: number }
	| { type: 'UNDO' }
	| { type: 'REDO' };

// ── Helpers ─────────────────────────────────────────────────────────

function snapshotHoldings(
	holdings: Record<string, Holding>,
): Record<string, Holding> {
	const result: Record<string, Holding> = {};
	for (const [k, h] of Object.entries(holdings)) {
		result[k] = { ...h };
	}
	return result;
}

function withHistory(
	state: PortfolioState,
	newHoldings: Record<string, Holding>,
): PortfolioState {
	return {
		...state,
		past: [...state.past, { holdings: snapshotHoldings(state.holdings) }].slice(
			-50,
		),
		future: [],
		holdings: newHoldings,
	};
}

function updateHolding(
	holdings: Record<string, Holding>,
	key: string,
	patch: Partial<Holding>,
): Record<string, Holding> {
	return {
		...holdings,
		[key]: { ...holdings[key]!, ...patch },
	};
}

// ── Reducer ─────────────────────────────────────────────────────────

export const initialState: PortfolioState = {
	refreshRateMs: 5_000,
	holdings: {},
	past: [],
	future: [],
};

export function portfolioReducer(
	state: PortfolioState,
	action: PortfolioAction,
): PortfolioState {
	switch (action.type) {
		case 'ADD_HOLDING':
			return {
				...state,
				holdings: {
					...state.holdings,
					[action.key]: { ...action.init, price: undefined },
				},
			};

		case 'REMOVE_HOLDING': {
			const { [action.key]: _, ...rest } = state.holdings;
			return { ...state, holdings: rest };
		}

		case 'SET_SHARES':
			return withHistory(
				state,
				updateHolding(state.holdings, action.key, { shares: action.shares }),
			);

		case 'SET_COST_BASIS':
			return withHistory(
				state,
				updateHolding(state.holdings, action.key, {
					costBasis: action.costBasis,
				}),
			);

		case 'SET_SYMBOL':
			return {
				...state,
				// No history push for symbol
				holdings: updateHolding(state.holdings, action.key, {
					symbol: action.symbol,
					price: undefined,
				}),
			};

		case 'SET_PRICE':
			return {
				...state,
				holdings: updateHolding(state.holdings, action.key, {
					price: action.price,
				}),
			};

		case 'SET_REFRESH_RATE':
			return { ...state, refreshRateMs: action.rateMs };

		case 'UNDO': {
			if (state.past.length === 0) return state;
			const prev = state.past[state.past.length - 1]!;
			// Preserve prices from current state
			const restored: Record<string, Holding> = {};
			for (const [k, h] of Object.entries(prev.holdings)) {
				restored[k] = { ...h, price: state.holdings[k]?.price };
			}
			return {
				...state,
				past: state.past.slice(0, -1),
				future: [
					{ holdings: snapshotHoldings(state.holdings) },
					...state.future,
				],
				holdings: restored,
			};
		}

		case 'REDO': {
			if (state.future.length === 0) return state;
			const next = state.future[0]!;
			const restored: Record<string, Holding> = {};
			for (const [k, h] of Object.entries(next.holdings)) {
				restored[k] = { ...h, price: state.holdings[k]?.price };
			}
			return {
				...state,
				past: [...state.past, { holdings: snapshotHoldings(state.holdings) }],
				future: state.future.slice(1),
				holdings: restored,
			};
		}
	}
}

// ── Derived values (computed on every call, not cached) ─────────────

export function getDerived(holding: Holding): HoldingDerived {
	const { price, shares, costBasis } = holding;
	if (price == null) {
		return {
			marketValue: undefined,
			gainLoss: undefined,
			gainLossPercent: undefined,
			isUp: undefined,
		};
	}
	const marketValue = shares * price;
	const gainLoss = (price - costBasis) * shares;
	const gainLossPercent =
		costBasis === 0 ? undefined : ((price - costBasis) / costBasis) * 100;
	const isUp = gainLoss >= 0;
	return { marketValue, gainLoss, gainLossPercent, isUp };
}

// ── Async polling (manual AbortController, no framework help) ───────

export function startPolling(
	getState: () => PortfolioState,
	dispatch: (action: PortfolioAction) => void,
	key: string,
): AbortController {
	const controller = new AbortController();
	const { signal } = controller;

	(async () => {
		while (!signal.aborted) {
			try {
				const symbol = getState().holdings[key]?.symbol;
				if (!symbol) break;
				const res = await fetch(`/api/quote/${symbol}`, { signal });
				if (signal.aborted) break;
				const data = await res.json();
				dispatch({ type: 'SET_PRICE', key, price: data.price as number });
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, getState().refreshRateMs);
					signal.addEventListener(
						'abort',
						() => {
							clearTimeout(timer);
							reject(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true },
					);
				});
			} catch {
				break;
			}
		}
	})();

	return controller;
}
