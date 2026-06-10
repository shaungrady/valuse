/**
 * Illustrative React components — MobX
 *
 * `observer()` HOC wraps every component that reads observables. It
 * automatically tracks which properties are accessed during render
 * and re-renders on change. Forgetting `observer` is a silent bug.
 */

import { observer } from 'mobx-react-lite';
import { HoldingModel, HoldingsCollection, refreshConfig } from './mobx.js';

// ── Per-holding row ────────────────────────────────────────────────

// Every component reading observables MUST be wrapped with observer()
const HoldingRow = observer(function HoldingRow({
	holding,
}: {
	holding: HoldingModel;
}) {
	// Direct property access — MobX tracks reads automatically
	const { symbol, shares, costBasis, marketValue, gainLossPercent, isUp } =
		holding;

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
					onChange={(e) => holding.setShares(Number(e.target.value))}
				/>
			</td>
			<td>${costBasis.toFixed(2)}</td>
			<td>${marketValue?.toFixed(2) ?? '...'}</td>
			<td>{gainLossPercent?.toFixed(1) ?? '...'}%</td>
			<td>
				<button onClick={() => holding.undo()}>Undo</button>
				<button onClick={() => holding.redo()}>Redo</button>
			</td>
		</tr>
	);
});

// ── Portfolio table ────────────────────────────────────────────────

const Portfolio = observer(function Portfolio({
	collection,
}: {
	collection: HoldingsCollection;
}) {
	return (
		<>
			<label>
				Refresh rate:{' '}
				<input
					type="number"
					value={refreshConfig.rateMs}
					onChange={(e) => refreshConfig.setRate(Number(e.target.value))}
				/>
				ms
			</label>
			<table>
				<tbody>
					{[...collection.holdings.entries()].map(([key, holding]) => (
						<HoldingRow key={key} holding={holding} />
					))}
				</tbody>
			</table>
		</>
	);
});

export { HoldingRow, Portfolio };
