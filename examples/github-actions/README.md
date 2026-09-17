# GitHub Actions

`npx hydration-proof init --ci github` writes
[`hydration-proof.yml`](hydration-proof.yml) and a config;
[`hydration-proof.config.ts`](hydration-proof.config.ts) here is that config with
the CI policy filled in, and [`hydration-proof-sharded.yml`](hydration-proof-sharded.yml)
is the same run split across four parallel jobs.

The reporter needs no configuration: when `GITHUB_ACTIONS` is set, findings
become annotations on the changed lines and the full list goes into the job
summary. SARIF uploads the same findings to the Security tab, so they show up in
code scanning with the owner and the docs link.

## Adopting on an app that already has problems

A first run on a real app usually finds something. Do not start with a red
pipeline:

```bash
npx hydration-proof baseline      # record what exists today
git add .hydration-proof/baseline.json
```

With `ci.newIssuesOnly: true` the run then fails only on findings that are *not*
in the baseline, so the pipeline is green from day one and every new problem is
caught. Shrink the baseline as pages get fixed; `ci.budget` is the ratchet that
stops it growing again.

## Making it fast

- **`--shard i/n`** splits the routes across parallel jobs. Each job writes its
  own report; `merge-reports` combines them and decides the exit code, so the
  policy is applied once over everything rather than per shard.
- **`--changed`** tests only the routes affected by the files a pull request
  touches, by following the import graph. Good for pull requests, not for the
  main branch.
- Cache the Playwright browsers on `~/.cache/ms-playwright`, keyed by the
  Playwright version. It is the slowest step by far.
- `ci.history` keeps one line per run; the HTML report draws the trend of the
  last 30. Cache or commit that file, or the trend starts over every run.

## Reading the output

Upload `.hydration-proof/report/` as an artifact. `report.html` is one
self-contained file with the server and client DOM side by side, the highlighted
element, screenshots and the mutation timeline — it is what you actually debug
from. Reports can contain page content, so treat the artifact like test output of
the app itself ([security](../../docs/security.md)).
