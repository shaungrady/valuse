# Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for
versioning and automated npm publishing via GitHub Actions.

## Initial Setup (one-time)

### 1. npm OIDC Authentication

Configure an OIDC connection in your npm account settings so GitHub Actions can
publish without a stored long-lived token:

1. Go to [npmjs.com](https://www.npmjs.com) → Account Settings → Granular Access
   Tokens → Generate New Token
2. Select **Automation** token type, or set up OIDC linking under your account's
   security settings
3. Add the token as a repository secret named `NPM_TOKEN` in GitHub → Settings →
   Secrets and variables → Actions

### 2. GitHub Actions Permissions

In the repository settings (Settings → Actions → General):

- Set **Workflow permissions** to "Read and write permissions"
- Enable "Allow GitHub Actions to create and approve pull requests"

---

## Development Workflow

### Documenting Changes

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

---

## Releasing

### Automated (recommended)

When changesets are merged to `main`, the release workflow automatically creates
a "Version Packages" pull request that:

- Bumps the version in `package.json`
- Updates `CHANGELOG.md`

Merging that PR triggers publishing to npm.

### Manual

```sh
# 1. Bump version and update CHANGELOG
pnpm version-packages

# 2. Commit and push
git add . && git commit -m "chore: version packages" && git push

# 3. Publish to npm
pnpm release
```
