/**
 * Stock portfolio — Jotai comparison example.
 *
 * Jotai models state as atoms. Per-holding state requires a family of
 * atoms (one per field per holding), and derived state uses `atom(get =>
 * ...)`. There is no single "holding model" definition; the shape is
 * spread across many atom declarations. Undo/redo requires a manual
 * history stack per atom or a third-party library. Async polling is
 * imperative (set atoms from outside, not via async atoms) to avoid
 * Suspense contagion in downstream derivations.
 */

import { atom, createStore, type Atom, type WritableAtom } from 'jotai';

// ── Shared config ───────────────────────────────────────────────────

export const refreshRateMsAtom = atom(5_000);

// ── Per-holding atoms ───────────────────────────────────────────────

export interface HoldingAtoms {
	symbol: WritableAtom<string, [string], void>;
	shares: WritableAtom<number, [number], void>;
	costBasis: WritableAtom<number, [number], void>;
	price: WritableAtom<number | undefined, [number | undefined], void>;
	marketValue: Atom<number | undefined>;
	gainLoss: Atom<number | undefined>;
	gainLossPercent: Atom<number | undefined>;
	isUp: Atom<boolean | undefined>;
}

export function createHoldingAtoms(init: {
	symbol: string;
	shares: number;
	costBasis: number;
}): HoldingAtoms {
	const symbolAtom = atom(init.symbol);
	const sharesAtom = atom(init.shares);
	const costBasisAtom = atom(init.costBasis);
	const priceAtom = atom<number | undefined>(undefined);

	const marketValueAtom = atom((get) => {
		const price = get(priceAtom);
		return price != null ? get(sharesAtom) * price : undefined;
	});

	const gainLossAtom = atom((get) => {
		const price = get(priceAtom);
		if (price == null) return undefined;
		return (price - get(costBasisAtom)) * get(sharesAtom);
	});

	const gainLossPercentAtom = atom((get) => {
		const price = get(priceAtom);
		const basis = get(costBasisAtom);
		if (price == null || basis === 0) return undefined;
		return ((price - basis) / basis) * 100;
	});

	const isUpAtom = atom((get) => {
		const gainLoss = get(gainLossAtom);
		return gainLoss != null ? gainLoss >= 0 : undefined;
	});

	return {
		symbol: symbolAtom,
		shares: sharesAtom,
		costBasis: costBasisAtom,
		price: priceAtom,
		marketValue: marketValueAtom,
		gainLoss: gainLossAtom,
		gainLossPercent: gainLossPercentAtom,
		isUp: isUpAtom,
	};
}

// ── History (manual per-holding) ────────────────────────────────────

interface HistorySnapshot {
	shares: number;
	costBasis: number;
}

export interface HoldingHistory {
	past: HistorySnapshot[];
	future: HistorySnapshot[];
}

export function createHoldingHistory(): HoldingHistory {
	return { past: [], future: [] };
}

function snapshot(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
): HistorySnapshot {
	return {
		shares: store.get(atoms.shares),
		costBasis: store.get(atoms.costBasis),
	};
}

function pushHistory(history: HoldingHistory, snap: HistorySnapshot): void {
	history.past.push(snap);
	if (history.past.length > 50) history.past.shift();
	history.future.length = 0;
}

// ── Coordinated setters (snapshot + set in one call) ────────────────

export function setShares(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
	history: HoldingHistory,
	value: number,
): void {
	pushHistory(history, snapshot(store, atoms));
	store.set(atoms.shares, value);
}

export function setCostBasis(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
	history: HoldingHistory,
	value: number,
): void {
	pushHistory(history, snapshot(store, atoms));
	store.set(atoms.costBasis, value);
}

export function setSymbol(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
	value: string,
): void {
	// No history push for symbol changes
	store.set(atoms.symbol, value);
	store.set(atoms.price, undefined);
}

export function undoHolding(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
	history: HoldingHistory,
): void {
	if (history.past.length === 0) return;
	history.future.unshift(snapshot(store, atoms));
	const prev = history.past.pop()!;
	store.set(atoms.shares, prev.shares);
	store.set(atoms.costBasis, prev.costBasis);
}

export function redoHolding(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
	history: HoldingHistory,
): void {
	if (history.future.length === 0) return;
	history.past.push(snapshot(store, atoms));
	const next = history.future.shift()!;
	store.set(atoms.shares, next.shares);
	store.set(atoms.costBasis, next.costBasis);
}

// ── Async polling (manual AbortController) ──────────────────────────

export function startPolling(
	store: ReturnType<typeof createStore>,
	atoms: HoldingAtoms,
): AbortController {
	const controller = new AbortController();
	const { signal } = controller;

	(async () => {
		while (!signal.aborted) {
			try {
				const symbol = store.get(atoms.symbol);
				const res = await fetch(`/api/quote/${symbol}`, { signal });
				if (signal.aborted) break;
				const data = await res.json();
				store.set(atoms.price, data.price as number);
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, store.get(refreshRateMsAtom));
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
