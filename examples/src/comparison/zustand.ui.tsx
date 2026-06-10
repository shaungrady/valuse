/**
 * Illustrative React components — Zustand
 *
 * `useStore(store, selector)` subscribes with a selector. Selectors
 * must be stable or memoized to avoid unnecessary re-renders. Derived
 * values recompute on every render (no reactive caching).
 */

import { useStore } from 'zustand';
import { createPortfolioStore, type PortfolioState } from './zustand.js';

const store = createPortfolioStore();

// ── Selectors (one per field you want to read) ────────────────────

const selectHolding = (key: string) => (s: PortfolioState) => s.holdings[key];

// ── Per-holding row ────────────────────────────────────────────────

function HoldingRow({ id }: { id: string }) {
	// Each selector is a separate subscription
	const holding = useStore(store, selectHolding(id));
	const setShares = useStore(store, (s) => s.setShares);
	const derived = useStore(store, (s) => s.getDerived(id));
	const undo = useStore(store, (s) => s.undo);
	const redo = useStore(store, (s) => s.redo);

	if (!holding) return null;

	return (
		<tr
			className={
				derived.isUp ? 'gain'
				: derived.isUp === false ?
					'loss'
				:	''
			}
		>
			<td>{holding.symbol}</td>
			<td>
				<input
					type="number"
					value={holding.shares}
					onChange={(e) => setShares(id, Number(e.target.value))}
				/>
			</td>
			<td>${holding.costBasis.toFixed(2)}</td>
			<td>${derived.marketValue?.toFixed(2) ?? '...'}</td>
			<td>{derived.gainLossPercent?.toFixed(1) ?? '...'}%</td>
			<td>
				<button onClick={undo}>Undo</button>
				<button onClick={redo}>Redo</button>
			</td>
		</tr>
	);
}

// ── Portfolio table ────────────────────────────────────────────────

function Portfolio() {
	const holdings = useStore(store, (s) => s.holdings);
	const refreshRateMs = useStore(store, (s) => s.refreshRateMs);
	const setRefreshRate = useStore(store, (s) => s.setRefreshRate);

	return (
		<>
			<label>
				Refresh rate:{' '}
				<input
					type="number"
					value={refreshRateMs}
					onChange={(e) => setRefreshRate(Number(e.target.value))}
				/>
				ms
			</label>
			<table>
				<tbody>
					{Object.keys(holdings).map((id) => (
						<HoldingRow key={id} id={id} />
					))}
				</tbody>
			</table>
		</>
	);
}

export { HoldingRow, Portfolio };
