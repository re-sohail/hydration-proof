# Reports

Reports are written to `.hydration-proof/report/` (see `outputDir`).

## Terminal (`list`)

One line per page while testing, the most important issues of failing pages with the server and client values, the likely cause, the source location and the first suggested fix, and a summary.

## JSON (`json`)

`report.json` contains everything: run information, a summary, every page and every issue. Its format is described by `node_modules/hydration-proof/schema/report.json` and only changes in a compatible way within `schemaVersion: 1`.

Every page records where its route came from (`source`: `config`, `discovered`, `manifest`, `sitemap`, `crawl` or `not-found`) and, when the tool started the app, the error and warning lines the server printed while the page loaded (`serverLogs`).

Every issue has a `fingerprint` that stays the same across runs as long as the problem is the same (same code, route pattern, element and attribute), which is what ignore rules and baselines use.

## HTML (`html`)

`report.html` is a single file you can open locally or publish as a CI artifact. It shows:

- a summary and filters (page status, issue severity, cause, kind, scenario, text search, ignored issues)
- per page: the issues with server and client values side by side (differences highlighted), the element on each side, the component, the source code, evidence and fixes, plus the server log lines printed while the page loaded
- screenshots of the page after hydration and of the server HTML without scripts, with the affected elements outlined (`screenshots: 'failures'` by default)
- a timeline of what happened on the page: scripts and RSC requests loading, React loading, hydration commits (root and Suspense boundaries), React errors, scripts changing the DOM, streamed content, and the steps of the navigation check
- for matrix runs, the other environments of the same route; for probe runs, what each probe changed; for repeated runs, flaky findings

Deep links such as `report.html#page=…&issue=…` open a specific finding. The page makes no network requests.

## CI formats

Add these with `--reporter` or `reporters`, for example `--reporter list,html,json,github,sarif`. [Running in CI](ci.md) has complete workflows.

File paths in the CI formats are relative to the repository root: the closest directory above the app that contains `.git` (or `GITHUB_WORKSPACE` for GitHub annotations, and `CI_PROJECT_DIR` for GitLab). A source file in another workspace package of a monorepo is therefore still linked. If an issue has no source location, or its source is outside the repository, the SARIF and GitLab formats attach it to line 1 of the config file (or of `package.json` if there is no config file) and name the real source in the message.

### JUnit XML (`junit`)

`junit.xml` works with any CI system that reads JUnit results (GitLab, CircleCI, Jenkins, Azure Pipelines, Buildkite and others):

- One `<testsuite>` per scenario, or per scenario and build mode with `--mode both`.
- One `<testcase>` per page, with `classname="hydration-proof.<scenario>[.<mode>]"` and the page path (with query string) as `name`. If the same path is tested twice in a suite, the later cases get ` (2)`, ` (3)`… so every classname and name pair is unique. `time` is the page's test time in seconds.
- A failed page has a `<failure>`. Its `type` is the first issue code and its `message` lists the error codes. The body lists each error with the element, the server and client values, the likely cause, the source location, the first fix and the documentation link.
- A page that could not be tested (for example, navigation failed) has an `<error>` whose `type` is the outcome.
- A page that only has warnings or info issues passes. Its issues are listed in `<system-out>`, together with the URL, the outcome and any ignored issues. Server log lines go to `<system-err>`.
- Ignored issues never fail a test case.

The test cases follow the page status and ignore `--fail-on` and `ci.maxWarnings`: with `--fail-on warning` the job fails while pages with only warnings still pass in JUnit, and with `--fail-on never` failed pages still show as failures. The exit code always applies the policy.

Values are quoted with escapes such as `\n` and `\u0000`, so invisible differences stay visible. Characters that XML 1.0 cannot contain are removed from the rest of the text.

### SARIF (`sarif`)

`report.sarif` is a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/) log for GitHub code scanning and other static-analysis dashboards:

- Every issue code is a rule. The `id` is the code (`HP1001`) and the `name` is a PascalCase version of its kebab-case name (`TextMismatch`). Each rule has the description, how to fix it and a documentation link. Its default level comes from the severity (`error`, `warning`, or `note` for info). Its tags are `hydration`, `react` and the group: `dom-mismatch`, `react-error`, `invalid-html`, `external-change`, `interaction`, `suppression` or `test-run`.
- There is one result per issue. Each result has:
  - the source file and line (relative to the repository root, with `uriBaseId: "%SRCROOT%"`), or the fallback described above
  - the route pattern, scenario and build mode as a logical location
  - `partialFingerprints["hydrationProof/v1"]`, the issue fingerprint, so code scanning recognizes an alert across runs
  - properties with the URL, stage, element, values and likely cause

  The same problem found in several scenarios or build modes gives one result per scenario and mode, all with the same fingerprint.
- Ignored issues are included with an `external` suppression, so code scanning does not open alerts for them.
- `invocations[0].executionSuccessful` is `false` only when the tool itself could not run (exit codes 2, 3, 4 and 70).

To upload it to GitHub code scanning, give the job the `security-events: write` permission:

```yaml
permissions:
  contents: read
  security-events: write

steps:
  # checkout, setup-node, npm ci, install
  - run: npx hydration-proof test --reporter list,html,json,github,sarif
  - uses: github/codeql-action/upload-sarif@v3
    if: ${{ !cancelled() && hashFiles('.hydration-proof/report/report.sarif') != '' }}
    with:
      sarif_file: .hydration-proof/report/report.sarif
      category: hydration-proof
```

Code scanning must be available for the repository: it is on for public repositories, and private repositories need GitHub Advanced Security (Code Security). Pull requests from forks get a read-only token, so the upload step fails there.

### GitHub Actions (`github`)

The `github` reporter prints [workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) and writes nothing to the report directory.

**Annotations.** Each problem becomes one `::error`, `::warning` or `::notice` (for info) annotation. The same fingerprint found in several scenarios, build modes or URLs of one route is merged into a single annotation that lists them. When the source location is known, the annotation is attached to that file and line, relative to `GITHUB_WORKSPACE`, so it shows up in the pull request's changed files. Otherwise it appears on the workflow run. The message has:

- the page and scenario
- the element
- the server and client values, up to 200 characters each
- the likely cause and its confidence
- the first fix
- the documentation link

GitHub shows at most 10 annotations of each level per step. The most important come first (by severity, then confidence, then route order). If there are more, a final notice says how many were left out.

**Job summary.** When `GITHUB_STEP_SUMMARY` is set (GitHub Actions sets it for every step), the reporter appends a Markdown summary with:

- a pass/fail headline and the policy failures
- a table of totals
- a table of the pages with problems
- a collapsible section per problem, with the server and client values, the source location (linked to the commit), the likely cause, fixes and documentation
- where to find the full report

Page content is escaped, so text with `|`, `<` or backticks cannot break the layout. GitHub rejects summaries over 1 MiB, so the page table and the problem sections are shortened, with a note, to stay under that size including earlier steps' output.

### GitLab Code Quality (`gitlab`)

`gl-code-quality.json` is a [Code Quality report](https://docs.gitlab.com/ci/testing/code_quality/) that GitLab shows in merge requests. It has one entry per issue that is not ignored:

- `check_name` is the issue code, and `description` is a one-line summary with the page, scenario, element, values and likely cause.
- `severity` depends on the issue: `critical` for errors with a confidence of 0.9 or more, `major` for other errors, `minor` for warnings and `info` for info.
- `location` is the source file and line (relative to `CI_PROJECT_DIR`), or the fallback described above.
- `fingerprint` is a SHA-256 of the issue fingerprint, scenario, build mode and URL path. It is unique within the file, as GitLab requires, and stays the same across runs.

Declare it, and the JUnit file, as reports:

```yaml
artifacts:
  when: always
  paths:
    - .hydration-proof/report
  reports:
    codequality: .hydration-proof/report/gl-code-quality.json
    junit: .hydration-proof/report/junit.xml
```

## Source locations

Issues point at the code that rendered the element when it can be proven:

- **Development builds** (`--mode development`): the exact file and line where the element was created.
- **Production builds with browser source maps** (`productionBrowserSourceMaps: true` in Next.js): the component that rendered the element. Its code is found in the loaded scripts and mapped back through the source maps.
- Otherwise the issue says why no location is shown (`sourceUnavailableReason`), for example when the scripts have no source maps, or when only framework code could be mapped (elements rendered by Server Components have no client code).
