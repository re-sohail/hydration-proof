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

## Tips

- `CI=true` turns on one retry per page and never reuses a server that is already running.
- Test the production build: build in an earlier step and keep the default `buildWhen: 'if-missing'`, or pass `--build` to force a fresh build.
- Use `--fail-on warning` to also fail on warnings, or `ci.maxWarnings` for a budget.
- Browsers are cached in `~/.cache/ms-playwright` (Linux). Cache that folder to skip the download.
