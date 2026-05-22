import 'valuse/react';
import type { PageState } from './model.js';

export interface TabOption<T extends string> {
	value: T;
	label: string;
}

export function TabBar<T extends string>({
	value,
	onChange,
	options,
	ariaLabel,
}: {
	value: T;
	onChange: (next: T) => void;
	options: ReadonlyArray<TabOption<T>>;
	ariaLabel: string;
}) {
	return (
		<div role="tablist" aria-label={ariaLabel}>
			{options.map((opt) => (
				<button
					key={opt.value}
					role="tab"
					aria-selected={opt.value === value}
					onClick={() => onChange(opt.value)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

export function DashboardPage({ state }: { state: PageState }) {
	const [view, setView] = state.view.use();
	const [period, setPeriod] = state.period.use();
	const [periodLabel] = state.periodLabel.use();
	const [showCompactCards] = state.showCompactCards.use();

	return (
		<div>
			<header>
				<TabBar
					ariaLabel="View"
					value={view}
					onChange={setView}
					options={[
						{ value: 'list', label: 'List' },
						{ value: 'grid', label: 'Grid' },
					]}
				/>
				<TabBar
					ariaLabel="Period"
					value={period}
					onChange={setPeriod}
					options={[
						{ value: 'daily', label: 'Daily' },
						{ value: 'weekly', label: 'Weekly' },
						{ value: 'monthly', label: 'Monthly' },
					]}
				/>
			</header>
			<h2>{periodLabel}</h2>
			<output
				aria-label="Layout"
				data-mode={showCompactCards ? 'grid' : 'list'}
			>
				{showCompactCards ? 'GridView' : 'ListView'}
			</output>
		</div>
	);
}
