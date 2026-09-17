# CLI

```text
hydration-proof <command> [options]
```

| Command | Purpose |
| --- | --- |
| `test` (default) | Test the app's routes for hydration problems |
| `baseline` | Test the app and record the current findings in the baseline (same options as `test`) |
| `merge-reports <report>...` | Combine the reports of parallel jobs into one |
| `init` | Create `hydration-proof.config.ts` and ignore the report folder in git; `--ci github` or `--ci gitlab` also writes a CI workflow |
| `install [browser...]` | Download browsers for the Playwright version hydration-proof uses (`chromium` by default) |
| `doctor` | Check Node.js, Playwright, browsers, the config file and framework detection |

Run `hydration-proof <command> --help` for the options of a command.

## `test`

| Option | Description |
| --- | --- |
| `-c, --config <file>` | Config file. Default: `hydration-proof.config.{ts,mts,js,mjs,cjs,json}` in the current directory |
| `-u, --url <url>` | Test an app that is already running; nothing is built or started |
| `-r, --route <path>` | Test only this route. Repeatable. Turns route discovery off |
| `--grep <regex>` | Only routes whose path matches |
| `-s, --scenario <name>` | Only this scenario. Repeatable |
| `--mode <mode>` | `production` (default), `development`, or `both` (tests both and marks issues found in only one) |
| `--build`, `--no-build` | Always rebuild, or never build, before testing. By default the app is built only when no build output exists |
| `--browser <name>` | `chromium` (default), `firefox` or `webkit` (scenarios from the matrix keep their browser) |
| `--channel <name>` | Use an installed browser such as `chrome` or `msedge` |
| `--no-matrix` | Test the scenarios without the environment matrix |
| `--probe` | Prove causes: reload pages with value mismatches with one thing changed (see `probes`) |
| `--interactions` | Type, click, focus and scroll while pages load, and check nothing is lost |
| `--navigation` | Compare client-side navigation to each route with loading it directly (Next.js) |
| `--repeat <n>` | Load every page `n` times and mark findings that appear in only some runs as flaky |
| `--reporter <list>` | Comma-separated reporters: `list`, `json`, `html`, `junit`, `sarif`, `github`, `gitlab` (default: `list,json,html`) |
| `-o, --output <dir>` | Report directory. Default `.hydration-proof/report` |
| `-w, --workers <n>` | Pages tested in parallel |
| `--timeout <ms>` | Per-page timeout |
| `--retries <n>` | Retries for pages that fail to load |
| `--fail-on <level>` | `error` (default), `warning`, `info` or `never` |
| `--headed` | Show the browser window |
| `--sitemap` | Also test the routes listed in the sitemap (`robots.txt`, `/sitemap.xml`) |
| `--crawl` | Also test same-origin links found on tested pages (depth 2, at most 50 routes; see `routes.crawl`) |
| `--no-cache` | Discover routes again instead of using `.hydration-proof/cache` |
| `--changed [ref]` | Only the routes the files changed since `ref` can affect (default: the pull request base or `origin/main`) |
| `--new-only` | Fail only on findings that are not in the baseline |
| `--update-baseline` | Write the baseline from this run's findings |
| `--project <name>` | Only this project of a monorepo config. Repeatable |
| `--shard <i/n>` | Test part `i` of `n`, for parallel CI jobs. Every page lands in exactly one shard |

Command-line options override the config file.

## `merge-reports`

```text
hydration-proof merge-reports shards/1 shards/2 shards/3 --output .hydration-proof/report
```

| Option | Description |
| --- | --- |
| `-o, --output <dir>` | Where the merged reports go. Default `.hydration-proof/report` |
| `--reporter <list>` | Reporters for the merged report. Default `list,json,html` |
| `-c, --config <file>` | Config whose CI policy (`failOn`, budgets, ignore rules) decides the exit code |
| `--fail-on <level>` | `error` (default), `warning`, `info` or `never` |

Each argument is a report folder or a `report.json` file. Screenshots are copied next to the merged report.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every page passed |
| 1 | Issues at or above `--fail-on`, too many warnings, or an expired ignore rule |
| 2 | Invalid configuration or command-line usage |
| 3 | The app could not be built, started or reached |
| 4 | The browser is not installed or could not start |
| 70 | Internal error (please report it) |
| 130 | Interrupted |

These values are stable.

## Package managers

| npm | pnpm | Yarn | Bun |
| --- | --- | --- | --- |
| `npx hydration-proof test` | `pnpm exec hydration-proof test` | `yarn hydration-proof test` | `bunx hydration-proof test` |
