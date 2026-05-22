import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createPageState, pageStateScope, type Router } from './model.js';
import { DashboardPage } from './components.js';

interface RouterMock extends Router {
	replace: Router['replace'] & {
		mock: { calls: unknown[][]; results: unknown[] };
		mockClear: () => void;
	};
}

function makeRouter(): RouterMock {
	const fn = vi.fn() as unknown as RouterMock['replace'];
	return {
		pathname: '/dashboard',
		replace: fn,
	};
}

describe('search-params: pageStateScope', () => {
	it('uses defaults when no URL params are present', () => {
		const state = createPageState({});
		expect(state.view.get()).toBe('list');
		expect(state.period.get()).toBe('weekly');
		expect(state.showCompactCards.get()).toBe(false);
		expect(state.periodLabel.get()).toBe('This Week');
	});

	it('hydrates from URL-style string inputs', () => {
		const state = createPageState({ view: 'grid', period: 'daily' });
		expect(state.view.get()).toBe('grid');
		expect(state.period.get()).toBe('daily');
		expect(state.showCompactCards.get()).toBe(true);
		expect(state.periodLabel.get()).toBe('Today');
	});

	it('pipeEnum silently clamps invalid URL input to the first option', () => {
		const state = createPageState({ view: 'banana', period: 'never' });
		expect(state.view.get()).toBe('list');
		expect(state.period.get()).toBe('daily');
	});

	it('null inputs (missing params) fall back to defaults', () => {
		const state = createPageState({ view: null, period: null });
		expect(state.view.get()).toBe('list');
		expect(state.period.get()).toBe('weekly');
	});
});

describe('search-params: router sync via onChange', () => {
	it('writes both params to the router on any tracked field change', async () => {
		const router = makeRouter();
		const state = createPageState({ router });

		state.view.set('grid');
		// onChange is microtask-batched; let one tick pass.
		await Promise.resolve();
		expect(router.replace).toHaveBeenCalledTimes(1);
		expect(router.replace).toHaveBeenLastCalledWith(
			'/dashboard?view=grid&period=weekly',
			{ scroll: false },
		);
	});

	it('writes the new period when period changes', async () => {
		const router = makeRouter();
		const state = createPageState({ router });

		state.period.set('monthly');
		await Promise.resolve();
		expect(router.replace).toHaveBeenLastCalledWith(
			'/dashboard?view=list&period=monthly',
			{ scroll: false },
		);
	});

	it('does NOT trigger router.replace when router is unset', async () => {
		const state = createPageState({});
		state.view.set('grid');
		await Promise.resolve();
		// router defaults to null; onChange is a no-op.
		expect(state.view.get()).toBe('grid');
	});

	it('attaching a router after creation works (valuePlain set)', async () => {
		const state = createPageState({});
		const router = makeRouter();
		state.router.set(router);

		state.view.set('grid');
		await Promise.resolve();
		expect(router.replace).toHaveBeenCalled();
	});

	it('setting router itself does NOT trigger an onChange write', async () => {
		// `valuePlain` is invisible to the reactive graph by design — assigning
		// the router slot must not produce a router.replace call.
		const router = makeRouter();
		const state = pageStateScope.create();
		state.router.set(router);
		await Promise.resolve();
		expect(router.replace).not.toHaveBeenCalled();
	});

	it('batches multiple synchronous writes into one router call', async () => {
		const router = makeRouter();
		const state = createPageState({ router });
		// reset count after constructor activity
		router.replace.mockClear();

		// Two synchronous writes in the same tick — onChange fires once.
		state.view.set('grid');
		state.period.set('daily');
		await Promise.resolve();
		expect(router.replace).toHaveBeenCalledTimes(1);
		expect(router.replace).toHaveBeenLastCalledWith(
			'/dashboard?view=grid&period=daily',
			{ scroll: false },
		);
	});
});

describe('search-params: derivations', () => {
	it('showCompactCards flips when view changes', () => {
		const state = createPageState({});
		expect(state.showCompactCards.get()).toBe(false);
		state.view.set('grid');
		expect(state.showCompactCards.get()).toBe(true);
	});

	it('periodLabel updates when period changes', () => {
		const state = createPageState({});
		expect(state.periodLabel.get()).toBe('This Week');
		state.period.set('daily');
		expect(state.periodLabel.get()).toBe('Today');
		state.period.set('monthly');
		expect(state.periodLabel.get()).toBe('This Month');
	});
});

describe('search-params: DashboardPage component', () => {
	it('renders the current view + period tabs as aria-selected', () => {
		const state = createPageState({ view: 'grid', period: 'daily' });
		render(<DashboardPage state={state} />);

		const gridTab = screen.getByRole('tab', { name: 'Grid' });
		expect(gridTab.getAttribute('aria-selected')).toBe('true');
		const dailyTab = screen.getByRole('tab', { name: 'Daily' });
		expect(dailyTab.getAttribute('aria-selected')).toBe('true');

		expect(screen.getByText('Today')).toBeDefined();
		const layout = screen.getByLabelText('Layout');
		expect(layout.getAttribute('data-mode')).toBe('grid');
	});

	it('clicking a tab updates the state and the rendered layout', () => {
		const state = createPageState({});
		render(<DashboardPage state={state} />);

		expect(screen.getByLabelText('Layout').getAttribute('data-mode')).toBe(
			'list',
		);

		fireEvent.click(screen.getByRole('tab', { name: 'Grid' }));
		expect(state.view.get()).toBe('grid');
		expect(screen.getByLabelText('Layout').getAttribute('data-mode')).toBe(
			'grid',
		);
	});

	it('clicking a Period tab updates the heading label', () => {
		const state = createPageState({});
		render(<DashboardPage state={state} />);
		expect(screen.getByText('This Week')).toBeDefined();

		fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }));
		expect(screen.getByText('This Month')).toBeDefined();
	});
});
