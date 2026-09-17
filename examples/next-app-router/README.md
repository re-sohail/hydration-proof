# A Next.js app, from nothing to a report

```bash
npx hydration-proof init      # writes the config below and ignores the report folder
npx hydration-proof install   # downloads Chromium
npx hydration-proof test
```

`init` reads your `package.json` and route folders, so the generated config is
usually already right. The version here adds the two things most apps want after
the first run: example values for dynamic segments, and the pages that are
allowed to differ.

What each part is for:

- **`server`** — how to build and start the app. Leave it out entirely if you
  start the app yourself and pass `--url http://localhost:3000`.
- **`routes.discover`** — read the routes from `app/` and `pages/` plus the build
  manifests. `routes.paths` adds routes discovery cannot know about.
- **`routes.dynamic`** — one real value per dynamic segment. Without it a
  `[slug]` route is skipped, because there is nothing to render.
- **`ignore`** — markup that is *meant* to differ: ad slots, analytics
  attributes, a third-party widget. Prefer a narrow selector over an attribute
  pattern, and write down why.

See [configuration](../../docs/configuration.md) for every option.
