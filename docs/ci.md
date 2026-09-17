# Running in CI

`hydration-proof test` exits with a non-zero code when it finds problems, so it works in any CI system. Install the browser with system dependencies first.

## GitHub Actions

```yaml
name: Hydration
on: [pull_request]

jobs:
  hydration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx hydration-proof install --with-deps
      - run: npx hydration-proof test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: hydration-report
          path: .hydration-proof/report
```

## GitLab CI

```yaml
hydration:
  image: node:24
  script:
    - npm ci
    - npx hydration-proof install --with-deps
    - npx hydration-proof test
  artifacts:
    when: always
    paths:
      - .hydration-proof/report
```

## Splitting across jobs

`--shard i/n` tests one part of the pages. The split depends only on the route and scenario, so the parts never overlap and together cover every page, however the jobs are scheduled:

```yaml
jobs:
  hydration:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      # checkout, setup-node, npm ci, install as above
      - run: npx hydration-proof test --shard ${{ matrix.shard }}/3 --output .hydration-proof/report-${{ matrix.shard }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: hydration-report-${{ matrix.shard }}
          path: .hydration-proof/report-${{ matrix.shard }}
```

Each job builds and starts the app itself. To build once, build in an earlier job, pass the build output as an artifact, and keep `buildWhen: 'if-missing'`.

## Signed-in pages

Store test credentials as CI secrets and read them in the scenario's `login` from `process.env` (see [Configuration](configuration.md#signed-in-pages)). Reports and screenshots can show what a signed-in user sees, so treat the report artifact like any other test output with user data.

## Tips

- `CI=true` turns on one retry per page and never reuses a server that is already running.
- Test the production build: build in an earlier step and keep the default `buildWhen: 'if-missing'`, or pass `--build` to force a fresh build.
- Use `--fail-on warning` to also fail on warnings, or `ci.maxWarnings` for a budget.
- Browsers are cached in `~/.cache/ms-playwright` (Linux). Cache that folder to skip the download.
