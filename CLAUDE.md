# valuse

Reactive state management library built on Preact Signals. Provides **scopes** —
structured reactive models with typed fields, derived state, and lifecycle
hooks.

## Session Start

Run `pnpm install` before beginning work to ensure dependencies are current.

## Development

```sh
pnpm dev          # watch mode build
pnpm test:watch   # watch mode tests
pnpm check        # full validation (format, lint, types, tests, build, dead code, cycles, publint)
pnpm check:fix    # same but auto-fixes format and lint
```

## Testing

Prefer parametric (data-driven) tests over repetitive individual cases. Tests
live in `src/__tests__/` — runtime tests as `*.test.ts` and type tests as
`types/*.test-d.ts`.

## Code Conventions

- **Conventional Commits**: `feat:`, `fix:`, `perf:`, `refactor:`, `test:`,
  `docs:`, `chore:`, `style:`
- Keep subject lines lowercase, imperative mood, under 72 characters
- No comments unless the WHY is non-obvious

## Exports

Four entry points: `valuse` (core), `valuse/react` (React hooks), `valuse/utils`
(pipe utilities), `valuse/middleware` (history, persistence, devtools)

## Releases

See [RELEASE.md](./RELEASE.md) for full details.

To include a change in the next release, run `pnpm changeset` alongside the code
change and commit the generated `.changeset/*.md` file. Select the bump type
(`patch` / `minor` / `major`) and write a user-facing summary.

Once changesets land on `main`, the release workflow automatically opens a
"Version Packages" PR that bumps the version and updates `CHANGELOG.md`. Merging
that PR publishes to npm.
