/**
 * Stock portfolio — Valtio comparison example.
 *
 * Valtio uses proxy-based state: mutate a plain object and subscribers
 * react. There are no built-in derivations, async primitives, or
 * undo/redo. All of those are implemented imperatively. Derived values
 * are computed inline (not cached). The upside is the simplest mutation
 * API of any library: just assign to properties.
 */

import { proxy, ref } from 'valtio';

// ── Types ──────────────────────────────────────────────────────────

export interface Holding {
	symbol: string;
	shares: number;
	costBasis: number;
	price: number | undefined;
}

interface HistorySnapshot {
	shares: number;
	costBasis: number;
}

// ── Shared config ───────────────────────────────────────────────────

export const refreshConfig = proxy({ rateMs: 5_000 });

// ── Per-holding state + helpers ─────────────────────────────────────

export interface HoldingState {
	data: Holding;
	past: HistorySnapshot[];
	future: HistorySnapshot[];
	controller: AbortController | undefined;
}

function historySnap(data: Holding): HistorySnapshot {
	return { shares: data.shares, costBasis: data.costBasis };
}

export function createHolding(init: {
	symbol: string;
	shares: number;
	costBasis: number;
}): HoldingState {
	return proxy<HoldingState>({
		data: { ...init, price: undefined },
		past: [],
		future: [],
		controller: undefined,
	});
}

// ── Derived (computed on demand, not cached) ────────────────────────

export function getDerived(state: HoldingState) {
	const { price, shares, costBasis } = state.data;
	if (price == null) {
		return {
			marketValue: undefined as number | undefined,
			gainLoss: undefined as number | undefined,
			gainLossPercent: undefined as number | undefined,
			isUp: undefined as boolean | undefined,
		};
	}
	const marketValue = shares * price;
	const gainLoss = (price - costBasis) * shares;
	const gainLossPercent =
		costBasis === 0 ? undefined : ((price - costBasis) / costBasis) * 100;
	const isUp = gainLoss >= 0;
	return { marketValue, gainLoss, gainLossPercent, isUp };
}

// ── Mutations (direct property assignment) ──────────────────────────

function pushHistory(state: HoldingState) {
	state.past.push(historySnap(state.data));
	if (state.past.length > 50) state.past.shift();
	state.future.length = 0;
}

export function setShares(state: HoldingState, shares: number) {
	pushHistory(state);
	state.data.shares = shares;
}

export function setCostBasis(state: HoldingState, costBasis: number) {
	pushHistory(state);
	state.data.costBasis = costBasis;
}

export function setSymbol(state: HoldingState, symbol: string) {
	// No history push for symbol changes
	stopPolling(state);
	state.data.symbol = symbol;
	state.data.price = undefined;
	startPolling(state);
}

// ── Undo / redo ─────────────────────────────────────────────────────

export function canUndo(state: HoldingState): boolean {
	return state.past.length > 0;
}

export function canRedo(state: HoldingState): boolean {
	return state.future.length > 0;
}

export function undo(state: HoldingState) {
	if (state.past.length === 0) return;
	state.future.unshift(historySnap(state.data));
	const prev = state.past.pop()!;
	state.data.shares = prev.shares;
	state.data.costBasis = prev.costBasis;
}

export function redo(state: HoldingState) {
	if (state.future.length === 0) return;
	state.past.push(historySnap(state.data));
	const next = state.future.shift()!;
	state.data.shares = next.shares;
	state.data.costBasis = next.costBasis;
}

// ── Async polling (manual AbortController) ──────────────────────────

export function startPolling(state: HoldingState) {
	stopPolling(state);
	const controller = new AbortController();
	// ref() prevents Valtio from proxying the controller (private #signal
	// fields break under proxies).
	state.controller = ref(controller);
	const { signal } = controller;

	(async () => {
		while (!signal.aborted) {
			try {
				const res = await fetch(`/api/quote/${state.data.symbol}`, { signal });
				if (signal.aborted) break;
				const json = await res.json();
				state.data.price = json.price as number;
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, refreshConfig.rateMs);
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
}

export function stopPolling(state: HoldingState) {
	state.controller?.abort();
	state.controller = undefined;
}

export function destroy(state: HoldingState) {
	stopPolling(state);
}

// ── Collection (plain Map — NOT reactive; add/remove won't trigger
//    re-renders. Use proxyMap from valtio/utils for reactive keys.) ───

export function createHoldingsMap() {
	const holdings = new Map<string, HoldingState>();
	return {
		add(
			key: string,
			init: { symbol: string; shares: number; costBasis: number },
		) {
			const state = createHolding(init);
			holdings.set(key, state);
			return state;
		},
		remove(key: string) {
			const state = holdings.get(key);
			if (state) destroy(state);
			holdings.delete(key);
		},
		get(key: string) {
			return holdings.get(key);
		},
		get size() {
			return holdings.size;
		},
		has(key: string) {
			return holdings.has(key);
		},
		destroy() {
			for (const state of holdings.values()) destroy(state);
			holdings.clear();
		},
	};
}
