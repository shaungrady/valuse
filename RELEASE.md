# Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for
versioning and automated npm publishing via GitHub Actions (OIDC).

## Documenting Changes

When making API changes, new features, or bug fixes, create a changeset:

```sh
pnpm changeset
```

Select the bump type and write a user-focused summary. Commit the changeset file
alongside your code changes.

| Bump type | When to use                                             |
| --------- | ------------------------------------------------------- |
| `patch`   | Bug fixes, performance improvements, internal refactors |
| `minor`   | New features, non-breaking additions                    |
| `major`   | Breaking changes                                        |

## Releasing

When changesets are merged to `main`, the release workflow automatically creates
a "Version Packages" pull request that:

- Bumps the version in `package.json`
- Updates `CHANGELOG.md`

Merging that PR publishes to npm.

### Manual

```sh
# 1. Bump version and update CHANGELOG
pnpm version-packages

# 2. Commit and push
git add . && git commit -m "chore: version packages" && git push

# 3. Publish to npm
pnpm release
```
