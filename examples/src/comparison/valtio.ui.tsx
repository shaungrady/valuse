/**
 * Illustrative React components — Valtio
 *
 * `useSnapshot(proxy)` returns a read-only snapshot for rendering.
 * Mutations go directly to the proxy (not the snapshot). Valtio tracks
 * which snapshot properties were accessed and only re-renders on those.
 */

import { useSnapshot } from 'valtio';
import {
	type HoldingState,
	refreshConfig,
	setShares as valtioSetShares,
	getDerived,
	undo,
	redo,
} from './valtio.js';

// ── Per-holding row ────────────────────────────────────────────────

function HoldingRow({ state }: { state: HoldingState }) {
	// useSnapshot for reading — direct mutation for writing
	const snap = useSnapshot(state);
	const { symbol, shares, costBasis } = snap.data;
	const derived = getDerived(state);

	return (
		<tr
			className={
				derived.isUp ? 'gain'
				: derived.isUp === false ?
					'loss'
				:	''
			}
		>
			<td>{symbol}</td>
			<td>
				<input
					type="number"
					value={shares}
					onChange={(e) => valtioSetShares(state, Number(e.target.value))}
				/>
			</td>
			<td>${costBasis.toFixed(2)}</td>
			<td>${derived.marketValue?.toFixed(2) ?? '...'}</td>
			<td>{derived.gainLossPercent?.toFixed(1) ?? '...'}%</td>
			<td>
				<button onClick={() => undo(state)}>Undo</button>
				<button onClick={() => redo(state)}>Redo</button>
			</td>
		</tr>
	);
}

// ── Portfolio table ────────────────────────────────────────────────

function Portfolio({ holdings }: { holdings: Map<string, HoldingState> }) {
	const config = useSnapshot(refreshConfig);

	return (
		<>
			<label>
				Refresh rate:{' '}
				<input
					type="number"
					value={config.rateMs}
					onChange={(e) => {
						refreshConfig.rateMs = Number(e.target.value);
					}}
				/>
				ms
			</label>
			<table>
				<tbody>
					{[...holdings.entries()].map(([key, state]) => (
						<HoldingRow key={key} state={state} />
					))}
				</tbody>
			</table>
		</>
	);
}

export { HoldingRow, Portfolio };
