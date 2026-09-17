# Contributing

Thanks for helping! Bug reports with a minimal reproduction are the most valuable contribution.

## Setup

```bash
pnpm install
pnpm --filter hydration-proof exec playwright-core install chromium firefox webkit
pnpm fixtures:build
```

## Layout

- `packages/hydration-proof/src/runtime` runs **inside the tested page**. It must never throw into the page, uses only DOM APIs (checked by `tsconfig.browser.json`) and is bundled to an IIFE.
- `packages/hydration-proof/src/shared` is used by both sides and must stay free of DOM and Node types.
- Everything else runs in Node.
- `packages/hydration-proof/src/issues/registry.ts` is the single source of truth for issue codes. `node scripts/generate-docs.ts` regenerates `docs/issues.md` and the JSON schemas.

## Rules

- **No new runtime dependencies.** `playwright-core` is the only one. Use Node built-ins or write the code.
- Issue codes, exit codes, the report schema and fingerprints are stable. Changing a fingerprint needs a `FINGERPRINT_VERSION` bump and a migration.
- Every new detection needs a fixture case in `fixtures/cases.ts` (a broken page **and** a correct control) and must keep `pnpm test:e2e` at 100% detection with 0 false positives.
- New React internals must be verified against React 18.3 and 19.x production **and** development builds (`tests/browser`).

## Checks

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
node scripts/generate-docs.ts --check
```

## Releasing

Add a changeset (`pnpm changeset`) describing the change for users. Releases are published from CI with npm trusted publishing.
