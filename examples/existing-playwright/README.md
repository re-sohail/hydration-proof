# Reusing a Playwright setup you already have

If the project already has Playwright, three things are worth reusing.

## The browsers

hydration-proof depends on `playwright-core`, which downloads nothing, and at
run time it prefers **your** `playwright-core` when it is 1.63 or newer. Your
existing browsers in `~/.cache/ms-playwright` are used as they are, and
`hydration-proof install` is only needed when the project has no Playwright at
all. Nothing is installed twice and nothing is downloaded during `npm install`.

## The login

A Playwright global setup that signs in and writes `storageState` is exactly what
a scenario wants. Point `storageState` at the same file and the login runs once,
in whichever suite runs first.

```ts
// playwright/global-setup.ts (yours, unchanged)
await context.storageState({ path: 'playwright/.auth/user.json' });
```

## The server

If Playwright's `webServer` already starts the app for the e2e suite, leave
`server` out of the hydration config entirely and pass the URL:

```bash
npx hydration-proof test --url http://localhost:3000
```

Or run it as a step inside your existing setup, which is the shape below.

## What not to do

Do not run hydration-proof as a Playwright *test*. It launches and drives its own
contexts, takes six DOM snapshots per page and needs the page loaded without
interference, so nesting it inside a Playwright worker fights for the same
browser and slows both down. Run it as its own command (or from Node with
`run()`), next to the e2e suite rather than inside it.
