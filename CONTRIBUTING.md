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
- Every **false positive** that gets fixed becomes a recorded control page, so it cannot come back (see below).
- New React internals must be verified against React 18.3 and 19.x production **and** development builds (`tests/browser`).

## The regression corpus

`fixtures/captures/` holds a real browser capture of every fixture page, taken
by `pnpm record:captures` and only when the page agreed with the ground truth in
`fixtures/cases.ts`. `tests/unit/regression/replay.test.ts` replays them through
the analysis without a browser, which takes under a second, so it runs on every
pull request and on every Node version and OS in the matrix. It fails when

- a control page starts reporting something (a false positive), or
- a broken page stops reporting, or reports a different code or element.

After fixing a false positive found in the wild:

```bash
# 1. add the page to fixtures/next-cases as a control in fixtures/cases.ts
# 2. fix the analysis
pnpm fixtures:build
pnpm record:captures            # or: pnpm record:captures /my-route
```

The recordings are data, not goldens to be regenerated when a test turns red: a
diff in `fixtures/captures/` means the captured pages changed, and a failure in
the replay test means the analysis changed. Only the first is a reason to
re-record.

## Compatibility

`pnpm versions --next 16.2.4` and `pnpm versions --react 19.0.0` pin the fixture
apps to other framework versions (`pnpm versions --reset` restores them); this is
what `.github/workflows/compat.yml` does across the supported range.

`pnpm smoke npm|pnpm|yarn|yarn-pnp|bun` packs the package and installs it into a
fresh Next.js app with that package manager, then runs `init`, `doctor` and
`test` against it.

`.github/workflows/real-world.yml` runs the packed CLI against pinned
open-source Next.js apps. Those apps are expected to be clean, so **any** finding
there fails the job: it is the false-positive check on code nobody here wrote.
Detection is proven by the fixtures instead.

What each surface promises is written down in
[docs/compatibility.md](docs/compatibility.md); read it before changing a config
option, an issue code, the report schema or a fingerprint.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
node scripts/generate-docs.ts --check
```

## Releasing

Add a changeset (`pnpm changeset`) describing the change for users. Releases are
published from CI with npm trusted publishing (OIDC), so there is no npm token;
[RELEASING.md](RELEASING.md) has the full procedure, including the one manual
first publish each package needs.
