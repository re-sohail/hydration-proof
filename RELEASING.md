# Releasing

Two packages are published, and they are versioned **in lockstep** (the
`fixed` group in `.changeset/config.json`), so a release always publishes both at
the same version:

- [`hydration-proof`](https://www.npmjs.com/package/hydration-proof)
- [`eslint-plugin-hydration-proof`](https://www.npmjs.com/package/eslint-plugin-hydration-proof)

Releases are published from CI with **npm trusted publishing (OIDC)**, so there
is no long-lived npm token anywhere. That has one consequence worth knowing
before the first release: trusted publishing is configured *on a package that
already exists*, so **the very first version of each package is published by
hand**, once. Everything after that is automatic.

## Before any release

```bash
pnpm install
pnpm --filter hydration-proof exec playwright-core install --with-deps chromium firefox webkit

pnpm typecheck              # both packages, the scripts and the examples
pnpm test                   # unit + browser (1344 tests)
pnpm fixtures:build
pnpm test:e2e               # the built CLI against every fixture app
pnpm verify:fixtures        # React itself confirms each broken fixture
pnpm build                  # publint, are-the-types-wrong, size budget
node scripts/generate-docs.ts --check
```

Everything must be green. `pnpm build` is what fails on a packaging mistake:
`publint --strict`, `attw --profile esm-only`, the `dist-artifacts` test and the
size budget all run inside it.

Optional but worth it before a minor release:

```bash
pnpm smoke npm && pnpm smoke pnpm && pnpm smoke yarn && pnpm smoke yarn-pnp && pnpm smoke bun
```

## 1. Write a changeset

One per user-visible change, in the words of someone who will read the changelog:

```bash
pnpm changeset
```

Pick `hydration-proof`; the plugin follows automatically because of the fixed
group. Use `minor` while the version is below 1.0 — that is where new features
go — and `patch` for fixes.

## 2. Version

On a branch, or let the CI release job open the version pull request for you:

```bash
pnpm changeset version
```

This rewrites both `package.json` files and both `CHANGELOG.md` files and
deletes the consumed changesets. Read the changelog it produced before going on:
it is the only part of a release users actually see.

## 3. The first publish of each package (once, by hand)

This step needs an npm account with publish rights and 2FA, and it is the one
step that is not automated.

```bash
npm login

pnpm --filter hydration-proof build
cd packages/hydration-proof
npm publish --access public --provenance=false   # provenance needs CI
cd ../..

pnpm --filter eslint-plugin-hydration-proof build
cd packages/eslint-plugin-hydration-proof
npm publish --access public --provenance=false
```

`prepublishOnly` rebuilds the package, so a stale `dist` cannot be published.

Then, on npmjs.com, for **each** package: *Settings → Trusted publishing → Add
a trusted publisher*, with

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization / user | `re-sohail` |
| Repository | `hydration-proof` |
| Workflow filename | `release.yml` |
| Environment | *(leave empty)* |

Nothing else needs to change: `.github/workflows/release.yml` already requests
the OIDC token (`permissions: id-token: write`), upgrades npm (trusted
publishing needs npm ≥ 11.5.1), and deliberately passes **no** `NPM_TOKEN`.

## 4. Every release after that

Merge to `main`. The release workflow runs the whole verification suite and then
`changesets/action`:

- **Changesets are pending** → it opens or updates a "Version Packages" pull
  request that runs `changeset version` for you. Review the changelog and merge
  it.
- **No changesets are pending and the versions are new** → it runs
  `pnpm changeset publish`, which publishes both packages and pushes the git
  tags.

Because the publish happens through OIDC, every published version gets a
provenance attestation. Verify one from a consumer's point of view:

```bash
npm audit signatures
npm view hydration-proof dist-tags
```

## After publishing

```bash
# The tarball users will actually install.
npx hydration-proof@latest init
npx hydration-proof@latest install chromium
npx hydration-proof@latest test
```

Then check the docs site at https://hydration.jscrate.dev reflects the new
version, and that the links in the changelog work.

## If something goes wrong

- **A bad version is already on npm.** Do not unpublish; publish a patch.
  `npm deprecate hydration-proof@0.9.0 "Use 0.9.1"` points people at it.
- **The publish failed halfway** (one package published, one not). Re-running
  the job is safe: `changeset publish` skips versions that already exist.
- **OIDC is refused.** The usual causes are npm older than 11.5.1 on the runner,
  a workflow filename that does not match the trusted publisher, or a
  self-hosted runner (trusted publishing needs a GitHub-hosted one).

## What is stable

From 1.0 on, these are covered by semver and must not change in a patch or
minor release: the CLI commands and flags, the config options, the report
schema (`schemaVersion`), issue fingerprints (`fingerprintVersion`), the exit
codes, the issue codes in `src/issues/registry.ts`, and the adapter and plugin
APIs. Changing a fingerprint means bumping `FINGERPRINT_VERSION` and shipping a
migration, so that existing baselines keep working.
