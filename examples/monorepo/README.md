# Several apps in one repository

```text
repo/
  hydration-proof.config.ts        ← lists the projects
  apps/web/hydration-proof.config.ts
  apps/admin/hydration-proof.config.ts
  apps/docs/hydration-proof.config.ts
```

```bash
npx hydration-proof test                 # every project, one report
npx hydration-proof test --project admin # just one
```

Each app keeps its own config: its own server command, port, routes, scenarios
and CI policy. The root config only says which apps exist. The run fails when
any project fails, and the combined report groups findings by project so a
finding is never ambiguous about which app it came from.

Why not one config with all the routes? Because the apps have different servers.
The projects run one after another, each with its own server started and stopped
around it, which is also why each app needs its own **port**.

Useful with this:

- **`--changed`** follows the import graph from the files a pull request touches
  to the routes that render them, across package boundaries. In a monorepo that
  is the difference between testing three apps and testing four pages. A shared
  package that everything imports will still select everything — that is correct,
  not a bug.
- Per-project `ci.budget` lets the app that is already clean stay at zero while
  the legacy app works its numbers down.
- Owners come from the root `CODEOWNERS`, so findings are attributed per app
  without configuring anything.
