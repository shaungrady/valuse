/**
 * Illustrative React components — Jotai
 *
 * Each atom is subscribed individually with `useAtomValue` / `useAtom`.
 * Fine-grained by default, but verbose: every readable field needs its
 * own hook call, and atoms must be threaded through props or context.
 */

import { useAtomValue, useAtom } from 'jotai';
import { refreshRateMsAtom, type HoldingAtoms } from './jotai.js';

// ── Per-holding row ────────────────────────────────────────────────

function HoldingRow({
	atoms,
	onUndo,
	onRedo,
}: {
	atoms: HoldingAtoms;
	onUndo: () => void;
	onRedo: () => void;
}) {
	// One hook per atom — fine-grained, but verbose
	const symbol = useAtomValue(atoms.symbol);
	const [shares, setSharesRaw] = useAtom(atoms.shares);
	const costBasis = useAtomValue(atoms.costBasis);
	const marketValue = useAtomValue(atoms.marketValue);
	const gainLossPercent = useAtomValue(atoms.gainLossPercent);
	const isUp = useAtomValue(atoms.isUp);

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
					// setSharesRaw bypasses history — coordinated setters need
					// the store + history threaded through props or context
					onChange={(e) => setSharesRaw(Number(e.target.value))}
				/>
			</td>
			<td>${costBasis.toFixed(2)}</td>
			<td>${marketValue?.toFixed(2) ?? '...'}</td>
			<td>{gainLossPercent?.toFixed(1) ?? '...'}%</td>
			<td>
				{/* undo/redo requires store + atoms + history — threaded via props */}
				<button onClick={onUndo}>Undo</button>
				<button onClick={onRedo}>Redo</button>
			</td>
		</tr>
	);
}

// ── Portfolio table ────────────────────────────────────────────────

function Portfolio({
	entries,
}: {
	entries: {
		key: string;
		atoms: HoldingAtoms;
		onUndo: () => void;
		onRedo: () => void;
	}[];
}) {
	const [rate, setRate] = useAtom(refreshRateMsAtom);

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
					{entries.map(({ key, atoms, onUndo, onRedo }) => (
						<HoldingRow
							key={key}
							atoms={atoms}
							onUndo={onUndo}
							onRedo={onRedo}
						/>
					))}
				</tbody>
			</table>
		</>
	);
}

export { HoldingRow, Portfolio };
