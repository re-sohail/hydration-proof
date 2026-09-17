---
'hydration-proof': minor
---

CI and team workflows.

- **CI formats**: `junit` (one test case per page), `sarif` (SARIF 2.1.0 for GitHub code scanning, with stable fingerprints), `github` (annotations plus a job summary; added automatically on GitHub Actions) and `gitlab` (Code Quality report).
- **Baselines**: `hydration-proof baseline` records the current findings; `test --new-only` (or `ci.newIssuesOnly`) fails only on new ones. Entries keep their first-seen date, and hand-written `reason` and `expires` fields are kept; expired entries fail the run. `--update-baseline` refreshes the file. The baseline has a JSON schema.
- **Budgets** (`ci.budget`): allowed findings per severity, per route glob and per issue code.
- **Owners** (`owners`): route owners from the config and CODEOWNERS entries of source files, shown in every report and filterable in the HTML report.
- **Changed routes** (`--changed [ref]`): only the routes the changed files can affect, from an import graph of your sources (path aliases and workspace packages included).
- **Report merging** (`hydration-proof merge-reports`): combines the reports of `--shard` jobs, including screenshots, and applies the CI policy.
- **Monorepos** (`projects`, `--project`): test several apps, each with its own config, and get one combined report.
- **Trends** (`ci.history`): one NDJSON line per run; the HTML report shows the last 30 runs.
- **Redaction** (on by default, `redact`): emails, tokens, JWTs, API keys, card numbers and secret URL parameters are removed from all reports; custom patterns; elements can be blacked out in screenshots.
- **`init --ci github|gitlab`** writes a workflow for your package manager.
- Reports record the git commit and branch.
- The package size budget is now 800 KB unpacked / 250 KB gzipped.
