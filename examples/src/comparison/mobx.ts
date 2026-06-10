/**
 * Stock portfolio — MobX comparison example.
 *
 * MobX uses class-based models with `makeAutoObservable` for reactive
 * state. Computed values are cached and only recompute when dependencies
 * change. Async requires generator-based `flow()` or manual
 * AbortController handling. Undo/redo needs a manual snapshot stack.
 * Collections use plain Maps/arrays wrapped in observable.
 */

import { makeAutoObservable, observable, runInAction } from 'mobx';

// ── Shared config ───────────────────────────────────────────────────

export class RefreshConfig {
	rateMs = 5_000;

	constructor() {
		makeAutoObservable(this);
	}

	setRate(ms: number) {
		this.rateMs = ms;
	}
}

export const refreshConfig = new RefreshConfig();

// ── Holding model ───────────────────────────────────────────────────

interface HistorySnapshot {
	shares: number;
	costBasis: number;
}

export class HoldingModel {
	symbol: string;
	shares: number;
	costBasis: number;
	price: number | undefined = undefined;

	private past: HistorySnapshot[] = [];
	private future: HistorySnapshot[] = [];
	private controller: AbortController | undefined = undefined;

	constructor(init: { symbol: string; shares: number; costBasis: number }) {
		this.symbol = init.symbol;
		this.shares = init.shares;
		this.costBasis = init.costBasis;
		makeAutoObservable(this, {
			startPolling: false,
			stopPolling: false,
			destroy: false,
		});
	}

	// ── Computed (cached, reactive) ─────────────────────────────────

	get marketValue(): number | undefined {
		return this.price != null ? this.shares * this.price : undefined;
	}

	get gainLoss(): number | undefined {
		if (this.price == null) return undefined;
		return (this.price - this.costBasis) * this.shares;
	}

	get gainLossPercent(): number | undefined {
		if (this.price == null || this.costBasis === 0) return undefined;
		return ((this.price - this.costBasis) / this.costBasis) * 100;
	}

	get isUp(): boolean | undefined {
		return this.gainLoss != null ? this.gainLoss >= 0 : undefined;
	}

	// ── History ─────────────────────────────────────────────────────

	private snapshot(): HistorySnapshot {
		return { shares: this.shares, costBasis: this.costBasis };
	}

	private pushHistory() {
		this.past.push(this.snapshot());
		if (this.past.length > 50) this.past.shift();
		this.future.length = 0;
	}

	setShares(shares: number) {
		this.pushHistory();
		this.shares = shares;
	}

	setCostBasis(costBasis: number) {
		this.pushHistory();
		this.costBasis = costBasis;
	}

	setSymbol(symbol: string) {
		// No history push for symbol
		this.symbol = symbol;
		this.price = undefined;
		this.stopPolling();
		this.startPolling();
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	undo() {
		if (this.past.length === 0) return;
		this.future.unshift(this.snapshot());
		const prev = this.past.pop()!;
		this.shares = prev.shares;
		this.costBasis = prev.costBasis;
	}

	redo() {
		if (this.future.length === 0) return;
		this.past.push(this.snapshot());
		const next = this.future.shift()!;
		this.shares = next.shares;
		this.costBasis = next.costBasis;
	}

	// ── Async polling (manual AbortController) ──────────────────────

	startPolling() {
		this.stopPolling();
		const controller = new AbortController();
		this.controller = controller;
		const { signal } = controller;

		(async () => {
			while (!signal.aborted) {
				try {
					const res = await fetch(`/api/quote/${this.symbol}`, { signal });
					if (signal.aborted) break;
					const data = await res.json();
					runInAction(() => {
						this.price = data.price as number;
					});
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

	stopPolling() {
		this.controller?.abort();
		this.controller = undefined;
	}

	destroy() {
		this.stopPolling();
	}
}

// ── Collection ──────────────────────────────────────────────────────

export class HoldingsCollection {
	holdings = observable.map<string, HoldingModel>();

	constructor() {
		makeAutoObservable(this);
	}

	add(
		key: string,
		init: { symbol: string; shares: number; costBasis: number },
	) {
		const model = new HoldingModel(init);
		this.holdings.set(key, model);
		return model;
	}

	remove(key: string) {
		const model = this.holdings.get(key);
		model?.destroy();
		this.holdings.delete(key);
	}

	get(key: string): HoldingModel | undefined {
		return this.holdings.get(key);
	}

	get size(): number {
		return this.holdings.size;
	}

	has(key: string): boolean {
		return this.holdings.has(key);
	}

	destroy() {
		for (const model of this.holdings.values()) {
			model.destroy();
		}
		this.holdings.clear();
	}
}
