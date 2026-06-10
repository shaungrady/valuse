/**
 * Illustrative React components — ValUse
 *
 * `import 'valuse/react'` enables `.use()` hooks on all reactive types.
 * Each `.use()` call creates a fine-grained subscription; only the
 * component reading a field re-renders when that field changes.
 */

import 'valuse/react';
import { holdingScope, refreshRateMs } from './valuse.js';

const holdings = holdingScope.createMap<string>();

// ── Per-holding row ────────────────────────────────────────────────

function HoldingRow({ id }: { id: string }) {
	const holding = holdings.get(id)!;

	// Each .use() is a fine-grained subscription — no selectors needed
	const [symbol] = holding.symbol.use();
	const [shares, setShares] = holding.shares.use();
	const [costBasis] = holding.costBasis.use();
	const [marketValue] = holding.marketValue.use();
	const [gainLossPercent] = holding.gainLossPercent.use();
	const [isUp] = holding.isUp.use();

	return (
		<tr
			className={
				isUp ? 'gain'
				: isUp === false ?
					'loss'
				:	''
			}
		>
			<td>{symbol}</td>
			<td>
				<input
					type="number"
					value={shares}
					onChange={(e) => setShares(Number(e.target.value))}
				/>
			</td>
			<td>${costBasis.toFixed(2)}</td>
			<td>${marketValue?.toFixed(2) ?? '...'}</td>
			<td>{gainLossPercent?.toFixed(1) ?? '...'}%</td>
			<td>
				<button onClick={holding.$undo}>Undo</button>
				<button onClick={holding.$redo}>Redo</button>
			</td>
		</tr>
	);
}

// ── Portfolio table ────────────────────────────────────────────────

function Portfolio() {
	// Re-renders only when holdings are added/removed
	const keys = holdings.useKeys();
	const [rate, setRate] = refreshRateMs.use();

	return (
		<>
			<label>
				Refresh rate:{' '}
				<input
					type="number"
					value={rate}
					onChange={(e) => setRate(Number(e.target.value))}
				/>
				ms
			</label>
			<table>
				<tbody>
					{keys.map((id) => (
						<HoldingRow key={id} id={id} />
					))}
				</tbody>
			</table>
		</>
	);
}

export { HoldingRow, Portfolio };
