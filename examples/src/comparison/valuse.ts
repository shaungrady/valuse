/**
 * Stock portfolio — ValUse comparison example.
 *
 * Four derivation layers:
 *   fields → async price poll → gain/loss math → display flag
 */

import { value, valueRef, valueScope } from 'valuse';
import { withHistory } from 'valuse/middleware';

// Shared config — every holding reads the same refresh rate.
export const refreshRateMs = value<number>(5_000);

export const holdingScope = withHistory(
	valueScope(
		// Layer 1: editable fields + shared config ref
		{
			symbol: value<string>(),
			shares: value<number>(0),
			costBasis: value<number>(0),
			refreshRate: valueRef(refreshRateMs),
		},
		// Layer 2: async price poll — aborts and restarts when symbol changes
		{
			price: async ({ scope, set, signal, deferBy }) => {
				while (!signal.aborted) {
					const res = await fetch(`/api/quote/${scope.symbol.use()}`, {
						signal,
					});
					set((await res.json()).price as number);
					await deferBy(scope.refreshRate.use());
				}
			},
		},
		// Layer 3: sync derivations reading async price — no special handling
		{
			marketValue: ({ scope }) => {
				const price = scope.price.use();
				return price != null ? scope.shares.use() * price : undefined;
			},
			gainLoss: ({ scope }) => {
				const price = scope.price.use();
				if (price == null) return undefined;
				return (price - scope.costBasis.use()) * scope.shares.use();
			},
			gainLossPercent: ({ scope }) => {
				const price = scope.price.use();
				const basis = scope.costBasis.use();
				if (price == null || basis === 0) return undefined;
				return ((price - basis) / basis) * 100;
			},
		},
		// Layer 4: derivation from derivation — must be a later layer
		{
			isUp: ({ scope }) => {
				const gainLoss = scope.gainLoss.use();
				return gainLoss != null ? gainLoss >= 0 : undefined;
			},
		},
	),
	{ maxDepth: 50, fields: ['shares', 'costBasis'] },
);
