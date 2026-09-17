# Running in CI

`hydration-proof test` exits with a non-zero code when it finds problems, so it works in any CI system. Install the browser with system dependencies first. Add the reporters your CI system understands (see [Reports](reports.md#ci-formats)):

| CI system | Reporters |
| --- | --- |
| GitHub Actions | `list,html,json,github,sarif` |
| GitLab CI | `list,html,json,junit,gitlab` |
| CircleCI, Jenkins, Azure Pipelines, Buildkite, others | `list,html,json,junit` |

`hydration-proof init --ci github` or `--ci gitlab` writes a ready-made workflow for your package manager. On GitHub Actions, the `github` reporter is added automatically unless `--reporter` is given.

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

### Merging the shard reports

Download the shard reports in a final job and combine them into one report (HTML, JSON, JUnit, SARIF, ...). The merged run fails with the same policy as a normal run:

```yaml
  report:
    needs: hydration
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          pattern: hydration-report-*
          path: shards
      - run: npx hydration-proof merge-reports shards/* --output .hydration-proof/report --reporter list,html,json
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: hydration-report
          path: .hydration-proof/report
```

## Testing only what changed

On pull requests, `--changed` tests only the routes that the changed files can affect. hydration-proof reads the imports of your source files (including `@/` path aliases and workspace packages) and follows them from the changed files to the route files, their layouts and `_app`. Changes to `package.json`, lockfiles, `next.config`, `tsconfig`, `middleware` or environment files test every route.

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the base branch must be available
      # ...
      - run: npx hydration-proof test --changed
```

Without a value, `--changed` compares with the pull request's base branch (`GITHUB_BASE_REF`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`), or with `origin/main`. Give a ref to choose: `--changed origin/develop`. Run the full suite on the main branch as well, because `--changed` cannot see changes in data or in the server.

## Adopting on an existing app: baselines

An app that already has hydration problems can start blocking new ones right away:

```bash
npx hydration-proof baseline          # records the current findings
git add .hydration-proof/baseline.json
```

```yaml
      - run: npx hydration-proof test --new-only
```

With `--new-only` (or `ci.newIssuesOnly: true`), findings in the baseline are reported as known and do not fail the run; new findings do. Entries match by fingerprint, so they survive changes elsewhere on the page. Each entry records the route, the issue, the likely cause and the date it was first seen. Add a `reason` and an `expires` date to an entry by hand: the reason is shown in reports, and after the expiry date the finding fails the run again, so accepted problems do not stay forever. Run `hydration-proof baseline` (or `test --update-baseline`) again after fixing problems; fixed entries are removed and hand-written fields are kept. The file has a JSON schema (`node_modules/hydration-proof/schema/baseline.json`).

## Budgets

Instead of failing on any error, allow a number of findings, in total, per route or per issue code:

```ts
ci: {
  budget: {
    error: 3,
    warning: 20,
    routes: { '/checkout/**': { error: 0, warning: 0 } },
    codes: { HP1004: 2 },
  },
},
```

A budget for a severity replaces the "any finding fails" rule for that severity; the other limits fail the run when they are exceeded. Lower the numbers as problems are fixed.

## Owners

Findings show who owns them. Route owners come from the config; otherwise the CODEOWNERS entry of the finding's source file is used (`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` or `.gitlab/CODEOWNERS`):

```ts
owners: {
  routes: { '/checkout/**': ['@acme/payments'], '/blog/**': '@acme/content' },
  codeowners: true, // or a path, or false
},
```

The HTML report can be filtered by owner.

## Trends

`ci.history: true` appends one line per run to `.hydration-proof/history.ndjson` (or the path you give): the date, commit, branch, duration and the findings by severity and code. The HTML report shows the errors and warnings of the last 30 runs. Keep the file between runs, for example with `actions/cache` or by committing it on the main branch.

## Monorepos

A config at the repository root can list the apps to test. Each app keeps its own config (server, routes, scenarios, CI policy); the root writes one combined report:

```ts
// hydration-proof.config.ts at the repository root
export default defineConfig({
  projects: ['apps/web', { path: 'apps/admin', name: 'admin' }],
});
```

`--project admin` tests one of them. The run fails when any project fails.

## Personal data and secrets

Reports can contain what a page shows. Before anything is written, hydration-proof removes emails, bearer tokens, JWTs, API keys (GitHub, GitLab, Stripe, Slack, AWS, Google), private keys, card numbers (checked with the Luhn algorithm) and secret URL parameters (`token`, `key`, `session`, `password`, ...). Add your own patterns and black out elements in screenshots:

```ts
redact: {
  patterns: [/ORDER-\d{6}/, /\b\d{3}-\d{2}-\d{4}\b/],
  selectors: ['.account-number', '[data-private]'],
},
```

Fingerprints are computed before redaction, so baselines and ignore rules keep working. Set `redact: false` to keep everything (for example for local runs). Screenshots are only masked for `redact.selectors`; turn them off with `screenshots: 'off'` for pages with private data.

## Signed-in pages

Store test credentials as CI secrets and read them in the scenario's `login` from `process.env` (see [Configuration](configuration.md#signed-in-pages)). Reports and screenshots can show what a signed-in user sees, so treat the report artifact like any other test output with user data. The job summary and the annotations contain page text as well.

## Tips

- `CI=true` turns on one retry per page and never reuses a server that is already running.
- Test the production build: build in an earlier step and keep the default `buildWhen: 'if-missing'`, or pass `--build` to force a fresh build.
- Use `--fail-on warning` to also fail on warnings, or `ci.budget` to allow a number of findings.
- Browsers are cached in `~/.cache/ms-playwright` (Linux). Cache that folder to skip the download.
