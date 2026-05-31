# Examples Code & Test Review

Findings from reviewing the six runnable examples in `examples/src/`. Each item
is something I'd want to address before treating the example suite as a finished
proving ground for the library.

Grouped by severity. Item numbering is referenced in commits and follow-up work.

---

## Real issues

### 1. Type-erasure cascade through derivation contexts

**Status: resolved.** All example models migrated to the variadic
`valueScope(fields, {derivs}, config?)` form. `scope` inside each callback is
now inferred from the surrounding layers — no manual
`({ scope }: { scope: any })` or `SyncDerivationContext<Fields>` annotations
needed, and the `as`-casts at reading sites are gone.

Previously documented locations (now clean):

- `kanban-board/model.ts` — `scope.data.use()` is typed as
  `BoardApiResponse | undefined` directly.
- `stock-ticker/model.ts` — derivations read `scope.price.use()` and
  `scope.prevClose.use()` without re-casts.
- `kanban-board/components.tsx` — `cardCount` and similar values flow through
  with their declared types.

### 2. Transitive-lifecycle pattern is unverified

The stock-ticker markdown leads with "rows mount/unmount → WebSocket
opens/closes via `onUsed`/`onUnused`". The runnable example only verifies the
close-on-`$destroy` and close-on-symbol-change cases. The actual flagship
pattern (last-subscriber-detaches → stream closes) isn't tested.

Add:

```ts
it('onUnused closes the stream when last subscriber detaches', async () => {
  const inst = stockScope.create({ symbol: 'AAPL' });
  const unsub = inst.price.subscribe(() => {});
  await waitFor(() => expect(streams.has('AAPL')).toBe(true));
  unsub();
  await waitFor(() => expect(streams.get('AAPL')!.closed).toBe(true));
});
```

### 3. Throttled writes (`withPersistence`'s headline feature) untested

`examples/src/middleware/model.ts:46` uses `throttle: 0`. The markdown demoes
`throttle: 250`. No test verifies that multiple rapid `.set()`s coalesce into
one `localStorage.setItem` — exactly the "subtle correctness detail" the shipped
middleware exists to handle.

### 4. Form-wizard's `extendValues()` + `validate` composition isn't tested

The schema-validation doc emphasizes that base + extension `validate` rules both
run and issues concatenate. The form-wizard markdown shows
`orgStep = personalStep.extendValues(...)` but the runnable code doesn't include
it. Either include the orgStep variant or add a focused composition test.

### 5. Kanban's `bugCardScope` / `featureCardScope` are decorative

Defined and minimally tested, but neither is referenced by `boardScope` or its
components. They exist to demo `extendValues()`. Either integrate them (e.g., a
discriminator field that selects which template `cards.set` uses) or move them
to a separate `extending.test.ts` that focuses on the `.extendValues()` /
`.extendConfig()` pattern.

### 6. Kanban `$setSnapshot` round-trip with undeclared properties untested

`docs/scopes.md:252-254` claims undeclared props "appear in snapshots and
survive `$setSnapshot()` round-trips." Not asserted anywhere in the runnable
example. Add:

```ts
it('undeclared properties survive a snapshot round-trip', () => {
  const c = cardScope.create({
    id: 'c1',
    title: 'a',
    columnId: 'col',
    priority: 'high',
  } as any);
  const snap = c.$getSnapshot();
  expect((snap as any).priority).toBe('high');
  // ...round-trip via $setSnapshot...
});
```

---

## Test-shape issues

### 7. Module-global state in stock-ticker breaks isolation

`watchlist`, `isMarketOpen`, and `activeFactory` are all module-level. The
tests' `beforeEach` reset is correct but fragile — any new test that forgets the
reset bleeds. Refactor to a factory matching todo-app's `createTodoApp()` shape
so per-test state is fresh.

### 8. `setPriceStreamFactory` is module-mutated DI

`examples/src/stock-ticker/model.ts:16-30` mutates a module-level
`activeFactory`. Better to thread the factory in as a ref source (or scope
config option). At minimum the comment should say "for examples; production
wires WebSocket directly inside the async derivation."

### 9. Kanban `moveCard` only tests `toIndex: 0`

Insert-at-end and insert-at-middle uncovered. Add parameterized cases.

### 10. Filter cast in todo-app test (`as any`) could be tighter

`examples/src/todo-app/todo-app.test.tsx:45` uses `as any` with an
eslint-disable. Either move the assertion to a `pipeEnum`-focused test in the
source suite, or use `as never`.

### 11. `act()` wrapping inconsistent across files

todo-app wraps mutations in `act()` consistently. middleware and kanban-board
wrap selectively; search-params barely wraps. All currently pass because RTL is
forgiving, but inconsistency invites flakiness when assertions run before
microtasks settle. Standardize.

---

## Style and consistency

### 12. Different external-boundary mocking patterns per example

kanban uses `vi.stubGlobal('fetch', ...)`. stock-ticker uses a module-level
factory installer. search-params injects via constructor. Each is reasonable but
a one-line comment at the top of each test file explaining the choice would help
future readers.

### 13. Stock-ticker `StockRow` change-cell text format is fragile

`${(change as number).toFixed(2)}` is asserted literally as `"+10.00"`.
Reasonable but couples tests to formatting.

### 14. Kanban's Card uses pointer events without exercising them

`onPointerDown`/`onPointerUp` toggle `isDragging`, but no test exercises pointer
events; only `moveCard` is tested. Drag is shown but unverified. Either drop the
scaffolding or add a smoke test that toggling `isDragging` updates
`data-dragging`.

### 15. No test verifies models import outside React

All example tests mount components (triggering `valuse/react`). A bare
`import {...} from './model.js'; const x = scope.create();` smoke test per suite
would catch any accidental React-only dep leaking into model code.

---

## Nice-to-have

### 16. No `expect-type` tests for examples

Would lock in library fixes:

- `wizard.account` should be the account-step instance (factory-ref unwrap), not
  `ValueRef<...>`.
- `boardInstance.columns` should be `ScopeMap<string, ...>` with `.set` /
  `.useKeys` / `.delete` callable.
- `withPersistence(withHistory(base)).create().$undo` should be `() => void`.

A handful per example would catch any future regression in the
`MapEntry`/`ValueRef` unwrap and middleware composition fixes.

### 17. `bugCardScope`/`featureCardScope` should land in a focused `extending` test if they stay in kanban

If kept, move them and their tests into a separate file so the kanban example
focuses on what it actually builds.

---

## Status tracker

| #   | Item                                    | Status   |
| --- | --------------------------------------- | -------- |
| 1   | Derivation context type erasure         | Resolved |
| 2   | Transitive lifecycle test               | Open     |
| 3   | Throttled-write test                    | Open     |
| 4   | extend()+validate composition test      | Open     |
| 5   | bugCard/featureCard integration         | Open     |
| 6   | Undeclared-property snapshot round-trip | Open     |
| 7   | Stock-ticker module-global isolation    | Open     |
| 8   | setPriceStreamFactory DI shape          | Open     |
| 9   | moveCard toIndex coverage               | Open     |
| 10  | Todo-app filter `as any` cast           | Open     |
| 11  | act() wrapping consistency              | Open     |
| 12  | Boundary-mocking documentation          | Open     |
| 13  | StockRow text-format coupling           | Open     |
| 14  | Kanban Card pointer-event tests         | Open     |
| 15  | Model-only smoke imports                | Open     |
| 16  | expect-type tests per example           | Open     |
| 17  | bugCard/featureCard into focused file   | Open     |
