/**
 * Stock portfolio — Zustand comparison example.
 *
 * Zustand gives you a single flat store. Per-holding state lives in a
 * `Record<string, Holding>`, and every mutation spreads the holdings
 * map (the `immer` middleware can simplify this). Derived values are
 * computed inline (no reactive caching), undo/redo requires a manual
 * history stack, and async polling needs hand-rolled AbortControllers
 * stored alongside the data.
 */

import { createStore } from 'zustand';

// ── Types ──────────────────────────────────────────────────────────

export interface Holding {
	symbol: string;
	shares: number;
	costBasis: number;
	price: number | undefined;
}

interface HoldingDerived {
	marketValue: number | undefined;
	gainLoss: number | undefined;
	gainLossPercent: number | undefined;
	isUp: boolean | undefined;
}

interface HistoryEntry {
	holdings: Record<string, Holding>;
}

export interface PortfolioState {
	refreshRateMs: number;
	holdings: Record<string, Holding>;

	// Undo/redo (manual history stack, tracks shares + costBasis only)
	past: HistoryEntry[];
	future: HistoryEntry[];

	// Per-holding abort controllers for async polling
	controllers: Record<string, AbortController>;

	// Actions
	addHolding: (key: string, init: Omit<Holding, 'price'>) => void;
	removeHolding: (key: string) => void;
	setShares: (key: string, shares: number) => void;
	setCostBasis: (key: string, costBasis: number) => void;
	setSymbol: (key: string, symbol: string) => void;
	setPrice: (key: string, price: number) => void;
	setRefreshRate: (ms: number) => void;

	// Derived (computed on every call, not cached)
	getDerived: (key: string) => HoldingDerived;

	// Undo / redo
	undo: () => void;
	redo: () => void;
	canUndo: () => boolean;
	canRedo: () => boolean;

	// Async lifecycle
	startPolling: (key: string) => void;
	stopPolling: (key: string) => void;
	destroy: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

function snapshotForHistory(
	holdings: Record<string, Holding>,
): Record<string, Holding> {
	const snapshot: Record<string, Holding> = {};
	for (const [k, h] of Object.entries(holdings)) {
		snapshot[k] = { ...h };
	}
	return snapshot;
}

function pushHistory(state: PortfolioState): Partial<PortfolioState> {
	return {
		past: [
			...state.past,
			{ holdings: snapshotForHistory(state.holdings) },
		].slice(-50),
		future: [],
	};
}

// ── Store ───────────────────────────────────────────────────────────

export function createPortfolioStore() {
	return createStore<PortfolioState>((set, get) => ({
		refreshRateMs: 5_000,
		holdings: {},
		past: [],
		future: [],
		controllers: {},

		addHolding: (key, init) =>
			set((state) => ({
				holdings: {
					...state.holdings,
					[key]: { ...init, price: undefined },
				},
			})),

		removeHolding: (key) =>
			set((state) => {
				get().stopPolling(key);
				const { [key]: _, ...rest } = state.holdings;
				const { [key]: __, ...restControllers } = state.controllers;
				return { holdings: rest, controllers: restControllers };
			}),

		setShares: (key, shares) =>
			set((state) => ({
				...pushHistory(state),
				holdings: {
					...state.holdings,
					[key]: { ...state.holdings[key]!, shares },
				},
			})),

		setCostBasis: (key, costBasis) =>
			set((state) => ({
				...pushHistory(state),
				holdings: {
					...state.holdings,
					[key]: { ...state.holdings[key]!, costBasis },
				},
			})),

		setSymbol: (key, symbol) =>
			set((state) => {
				// Symbol change restarts polling but does NOT push history
				get().stopPolling(key);
				const next = {
					holdings: {
						...state.holdings,
						[key]: { ...state.holdings[key]!, symbol, price: undefined },
					},
				};
				// setTimeout because set() is synchronous — startPolling must
				// read the updated symbol, which isn't visible until set returns.
				setTimeout(() => get().startPolling(key), 0);
				return next;
			}),

		setPrice: (key, price) =>
			set((state) => ({
				holdings: {
					...state.holdings,
					[key]: { ...state.holdings[key]!, price },
				},
			})),

		setRefreshRate: (ms) => set({ refreshRateMs: ms }),

		getDerived: (key) => {
			const holding = get().holdings[key];
			if (!holding || holding.price == null) {
				return {
					marketValue: undefined,
					gainLoss: undefined,
					gainLossPercent: undefined,
					isUp: undefined,
				};
			}
			const { price, shares, costBasis } = holding;
			const marketValue = shares * price;
			const gainLoss = (price - costBasis) * shares;
			const gainLossPercent =
				costBasis === 0 ? undefined : ((price - costBasis) / costBasis) * 100;
			const isUp = gainLoss >= 0;
			return { marketValue, gainLoss, gainLossPercent, isUp };
		},

		undo: () =>
			set((state) => {
				if (state.past.length === 0) return state;
				const previous = state.past[state.past.length - 1]!;
				// Preserve prices from current state (history only tracks shares + costBasis)
				const restored: Record<string, Holding> = {};
				for (const [k, h] of Object.entries(previous.holdings)) {
					restored[k] = { ...h, price: state.holdings[k]?.price };
				}
				return {
					past: state.past.slice(0, -1),
					future: [
						{ holdings: snapshotForHistory(state.holdings) },
						...state.future,
					],
					holdings: restored,
				};
			}),

		redo: () =>
			set((state) => {
				if (state.future.length === 0) return state;
				const next = state.future[0]!;
				const restored: Record<string, Holding> = {};
				for (const [k, h] of Object.entries(next.holdings)) {
					restored[k] = { ...h, price: state.holdings[k]?.price };
				}
				return {
					past: [
						...state.past,
						{ holdings: snapshotForHistory(state.holdings) },
					],
					future: state.future.slice(1),
					holdings: restored,
				};
			}),

		canUndo: () => get().past.length > 0,
		canRedo: () => get().future.length > 0,

		startPolling: (key) => {
			const state = get();
			state.stopPolling(key);
			const controller = new AbortController();
			set((s) => ({
				controllers: { ...s.controllers, [key]: controller },
			}));

			(async () => {
				const { signal } = controller;
				while (!signal.aborted) {
					try {
						const holding = get().holdings[key];
						if (!holding) break;
						const res = await fetch(`/api/quote/${holding.symbol}`, {
							signal,
						});
						if (signal.aborted) break;
						const data = await res.json();
						get().setPrice(key, data.price as number);
						await new Promise<void>((resolve, reject) => {
							const timer = setTimeout(resolve, get().refreshRateMs);
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
		},

		stopPolling: (key) => {
			const controller = get().controllers[key];
			if (controller) controller.abort();
		},

		destroy: () => {
			const state = get();
			for (const key of Object.keys(state.controllers)) {
				state.stopPolling(key);
			}
		},
	}));
}
