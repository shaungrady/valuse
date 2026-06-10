/**
 * Illustrative React components — React Context
 *
 * `useContext` + `useReducer`. Every consumer re-renders on ANY state
 * change (no per-field subscriptions). The only built-in escape hatch
 * is `React.memo` with manual `areEqual`, or splitting into many
 * tiny contexts. Action types grow linearly with operations.
 */

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import {
	portfolioReducer,
	initialState,
	getDerived,
	type PortfolioState,
	type PortfolioAction,
} from './react-context.js';

// ── Context (must wrap the tree) ───────────────────────────────────

const PortfolioCtx = createContext<{
	state: PortfolioState;
	dispatch: Dispatch<PortfolioAction>;
}>({ state: initialState, dispatch: () => {} });

// ── Per-holding row ────────────────────────────────────────────────

function HoldingRow({ id }: { id: string }) {
	// Re-renders on ANY state change — no fine-grained subscriptions
	const { state, dispatch } = useContext(PortfolioCtx);
	const holding = state.holdings[id];
	if (!holding) return null;
	const derived = getDerived(holding);

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
					onChange={(e) =>
						dispatch({
							type: 'SET_SHARES',
							key: id,
							shares: Number(e.target.value),
						})
					}
				/>
			</td>
			<td>${holding.costBasis.toFixed(2)}</td>
			<td>${derived.marketValue?.toFixed(2) ?? '...'}</td>
			<td>{derived.gainLossPercent?.toFixed(1) ?? '...'}%</td>
			<td>
				<button onClick={() => dispatch({ type: 'UNDO' })}>Undo</button>
				<button onClick={() => dispatch({ type: 'REDO' })}>Redo</button>
			</td>
		</tr>
	);
}

// ── Portfolio table ────────────────────────────────────────────────

function Portfolio() {
	const [state, dispatch] = useReducer(portfolioReducer, initialState);

	return (
		<PortfolioCtx.Provider value={{ state, dispatch }}>
			<label>
				Refresh rate:{' '}
				<input
					type="number"
					value={state.refreshRateMs}
					onChange={(e) =>
						dispatch({
							type: 'SET_REFRESH_RATE',
							rateMs: Number(e.target.value),
						})
					}
				/>
				ms
			</label>
			<table>
				<tbody>
					{Object.keys(state.holdings).map((id) => (
						<HoldingRow key={id} id={id} />
					))}
				</tbody>
			</table>
		</PortfolioCtx.Provider>
	);
}

export { HoldingRow, Portfolio, PortfolioCtx };
