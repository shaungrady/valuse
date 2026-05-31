import { value, valuePlain, valueScope } from 'valuse';
import { pipeEnum } from 'valuse/utils';

// ── Router abstraction ────────────────────────────────────────────────
// The example doesn't depend on Next.js directly. In a real Next App
// Router page you'd construct a Router from `useRouter().replace` and
// `usePathname()`. The runnable version + tests use this minimal shape.
export interface Router {
	replace: (url: string, options?: { scroll?: boolean }) => void;
	pathname: string;
}

export const viewValues = ['list', 'grid'] as const;
export type View = (typeof viewValues)[number];

export const periodValues = ['daily', 'weekly', 'monthly'] as const;
export type Period = (typeof periodValues)[number];

const periodLabels: Record<Period, string> = {
	daily: 'Today',
	weekly: 'This Week',
	monthly: 'This Month',
};

export const pageStateScope = valueScope(
	{
		view: value<View>('list').pipe(pipeEnum(viewValues)),
		period: value<Period>('weekly').pipe(pipeEnum(periodValues)),

		// `valuePlain` keeps the router reference inert: writes don't trigger
		// re-renders or onChange — it's just where the side-effect target lives.
		router: valuePlain<Router | null>(null),
	},
	{
		showCompactCards: ({ scope }) => scope.view.use() === 'grid',
		periodLabel: ({ scope }) => periodLabels[scope.period.use()],
	},
	{
		// Push the URL back whenever a tracked field changes. `router.get()`
		// is non-reactive (valuePlain) so reading it here doesn't establish
		// a dependency on the slot.
		onChange: ({ scope }) => {
			const router = scope.router.get();
			if (!router) return;
			const params = new URLSearchParams();
			params.set('view', scope.view.get());
			params.set('period', scope.period.get());
			router.replace(`${router.pathname}?${params.toString()}`, {
				scroll: false,
			});
		},
	},
);

export type PageState = ReturnType<typeof pageStateScope.create>;

/**
 * Create a page-state instance from URL params (string | null). pipeEnum
 * silently clamps invalid values to the first allowed option, so this is
 * tolerant of bogus URL input.
 */
export function createPageState(input: {
	view?: string | null;
	period?: string | null;
	router?: Router | null;
}): PageState {
	const instance = pageStateScope.create({
		view: (input.view ?? 'list') as View,
		period: (input.period ?? 'weekly') as Period,
	});
	if (input.router) {
		instance.router.set(input.router);
	}
	return instance;
}
