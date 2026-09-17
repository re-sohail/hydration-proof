# CLI

```text
hydration-proof <command> [options]
```

| Command | Purpose |
| --- | --- |
| `test` (default) | Test the app's routes for hydration problems |
| `init` | Create `hydration-proof.config.ts` and ignore the report folder in git |
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
| `--mode <mode>` | `production` (default) or `development` |
| `--build`, `--no-build` | Always rebuild, or never build, before testing. By default the app is built only when no build output exists |
| `--browser <name>` | `chromium` (default), `firefox` or `webkit` |
| `--channel <name>` | Use an installed browser such as `chrome` or `msedge` |
| `--reporter <list>` | Comma-separated reporters: `list`, `json` |
| `-o, --output <dir>` | Report directory. Default `.hydration-proof/report` |
| `-w, --workers <n>` | Pages tested in parallel |
| `--timeout <ms>` | Per-page timeout |
| `--retries <n>` | Retries for pages that fail to load |
| `--fail-on <level>` | `error` (default), `warning`, `info` or `never` |
| `--headed` | Show the browser window |

Command-line options override the config file.

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
