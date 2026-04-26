# Example: Search Params Sync

A Next.js (App Router) page with two independent tab sets. The URL should
reflect both: `?view=grid&period=weekly`.

## The model

```ts
import { value, valuePlain, valueScope } from 'valuse';
import { pipeEnum } from 'valuse/utils';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

const pageState = valueScope(
  {
    view: value('list').pipe(pipeEnum(['list', 'grid'])),
    period: value('weekly').pipe(pipeEnum(['daily', 'weekly', 'monthly'])),

    router: valuePlain<{
      replace: AppRouterInstance['replace'];
      pathname: string;
    } | null>(null),

    showCompactCards: ({ scope }) => scope.view.use() === 'grid',
    periodLabel: ({ scope }) => {
      const labels = {
        daily: 'Today',
        weekly: 'This Week',
        monthly: 'This Month',
      };
      return labels[scope.period.use()];
    },
  },
  {
    onChange: ({ scope }) => {
      const router = scope.router.get();
      if (!router) return;

      const params = new URLSearchParams();
      params.set('view', scope.view.get());
      params.set('period', scope.period.get());
      router.replace(`${router.pathname}?${params}`, { scroll: false });
    },
  },
);
```

`pipeEnum` validates and narrows on write, so URL hydration is just passing raw
strings to `create()`. `onChange` writes back to the URL when anything changes.

## The hook

```ts
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useRef, useEffect } from 'react';

export function usePageState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const instanceRef = useRef<ReturnType<typeof pageState.create>>();

  if (!instanceRef.current) {
    instanceRef.current = pageState.create({
      view: searchParams.get('view'),
      period: searchParams.get('period'),
    });
  }

  // Keep the plain router slot in sync without allocating on every render.
  useEffect(() => {
    instanceRef.current?.router.set({ replace: router.replace, pathname });
  }, [router, pathname]);

  useEffect(() => {
    return () => instanceRef.current?.$destroy();
  }, []);

  return instanceRef.current;
}
```

## The page

```tsx
'use client';

import { usePageState } from './usePageState';

export default function DashboardPage() {
  const state = usePageState();

  const [view, setView] = state.view.use();
  const [period, setPeriod] = state.period.use();
  const [periodLabel] = state.periodLabel.use();
  const [showCompactCards] = state.showCompactCards.use();

  return (
    <div>
      <header>
        <TabBar
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'List' },
            { value: 'grid', label: 'Grid' },
          ]}
        />
        <TabBar
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
      {showCompactCards ?
        <GridView period={period} />
      : <ListView period={period} />}
    </div>
  );
}
```

Click "Grid", the URL becomes `?view=grid&period=weekly`. Refresh, and it
hydrates back.

## With `valueSchema`

If you already use a schema library, `valueSchema` replaces `pipeEnum` and adds
validation state:

```ts
import { type } from 'arktype';
import { valueSchema, valuePlain, valueScope } from 'valuse';

const View = type.enumerated('list', 'grid');
const Period = type.enumerated('daily', 'weekly', 'monthly');

const pageState = valueScope(
  {
    view: valueSchema(View, 'list'),
    period: valueSchema(Period, 'weekly'),
    router: valuePlain</* ... */ null>(null),
    // ...derivations same as above
  },
  {
    onChange: ({ scope }) => {
      // ...same URL sync
    },
  },
);
```

The difference: `?view=banana` is preserved and flagged rather than silently
clamped. Good for forms; for URL hydration where silent recovery is better, add
a morph to the schema (`type('string').pipe(...)` or Zod's `.catch()`).
