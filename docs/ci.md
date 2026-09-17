# Running in CI

`hydration-proof test` exits with a non-zero code when it finds problems, so it works in any CI system. Install the browser with system dependencies first. Add the reporters your CI system understands (see [Reports](reports.md#ci-formats)):

| CI system | Reporters |
| --- | --- |
| GitHub Actions | `list,html,json,github,sarif` |
| GitLab CI | `list,html,json,junit,gitlab` |
| CircleCI, Jenkins, Azure Pipelines, Buildkite, others | `list,html,json,junit` |

## GitHub Actions

```yaml
name: Hydration
on: [pull_request]

permissions:
  contents: read
  security-events: write # upload-sarif

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
      - run: npx hydration-proof test --reporter list,html,json,github,sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: ${{ !cancelled() && hashFiles('.hydration-proof/report/report.sarif') != '' }}
        with:
          sarif_file: .hydration-proof/report/report.sarif
          category: hydration-proof
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: hydration-report
          path: .hydration-proof/report
```

Problems appear as annotations on the changed files and in the job summary. The SARIF upload also adds them to the repository's code scanning alerts. Code scanning must be available for the repository (public repositories, or GitHub Advanced Security), and pull requests from forks cannot upload. Without it, leave out `sarif`, the `security-events` permission and the upload step.

## GitLab CI

```yaml
hydration:
  image: node:24
  script:
    - npm ci
    - npx hydration-proof install --with-deps
    - npx hydration-proof test --reporter list,html,json,junit,gitlab
  artifacts:
    when: always
    paths:
      - .hydration-proof/report
    reports:
      codequality: .hydration-proof/report/gl-code-quality.json
      junit: .hydration-proof/report/junit.xml
```

The merge request shows failing pages in the test summary and the problems in the Code Quality widget.

## CircleCI

```yaml
version: 2.1

jobs:
  hydration:
    docker:
      - image: cimg/node:lts
    steps:
      - checkout
      - run: npm ci
      - run: npx hydration-proof install --with-deps
      - run: npx hydration-proof test --reporter list,html,json,junit
      - store_test_results:
          path: .hydration-proof/report/junit.xml
      - store_artifacts:
          path: .hydration-proof/report
          destination: hydration-report

workflows:
  hydration:
    jobs:
      - hydration
```

`store_test_results` shows each tested page as a test in the Tests tab. `store_artifacts` keeps the HTML report, which you can open from the Artifacts tab.

## Other CI systems

Use `--reporter list,html,json,junit`, publish `.hydration-proof/report/junit.xml` as test results and keep `.hydration-proof/report` as an artifact. JUnit test cases follow the page status (see [Reports](reports.md#junit-xml-junit)), and the exit code applies `--fail-on`.

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
      - run: npx hydration-proof test --shard ${{ matrix.shard }}/3 --output .hydration-proof/report-${{ matrix.shard }} --reporter list,html,json,github,sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: ${{ !cancelled() && hashFiles(format('.hydration-proof/report-{0}/report.sarif', matrix.shard)) != '' }}
        with:
          sarif_file: .hydration-proof/report-${{ matrix.shard }}/report.sarif
          category: hydration-proof-${{ matrix.shard }}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: hydration-report-${{ matrix.shard }}
          path: .hydration-proof/report-${{ matrix.shard }}
```

Give each shard its own SARIF `category`. Otherwise each upload replaces the previous shard's results. Each shard adds its own annotations and job summary.

Each job builds and starts the app itself. To build once, build in an earlier job, pass the build output as an artifact, and keep `buildWhen: 'if-missing'`.

## Signed-in pages

Store test credentials as CI secrets and read them in the scenario's `login` from `process.env` (see [Configuration](configuration.md#signed-in-pages)). Reports and screenshots can show what a signed-in user sees, so treat the report artifact like any other test output with user data. The job summary and the annotations contain page text as well.

## Tips

- `CI=true` turns on one retry per page and never reuses a server that is already running.
- Test the production build: build in an earlier step and keep the default `buildWhen: 'if-missing'`, or pass `--build` to force a fresh build.
- Use `--fail-on warning` to also fail on warnings, or `ci.maxWarnings` for a budget.
- Browsers are cached in `~/.cache/ms-playwright` (Linux). Cache that folder to skip the download.
