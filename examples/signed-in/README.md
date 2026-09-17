# Public, customer and admin pages in one run

Hydration problems hide behind logins: a dashboard that renders a date, an admin
table that reads `localStorage`. A scenario is a set of pages tested with one
identity, so one command covers all three.

```bash
TEST_USER_EMAIL=… TEST_USER_PASSWORD=… ADMIN_SESSION=… npx hydration-proof test
```

Three ways to sign in, cheapest first:

1. **`cookies`** — when the app accepts a session value you can mint for tests.
   No browser work, so it costs nothing.
2. **`storageState`** — a file Playwright wrote (`context.storageState({ path })`).
   Good when you already have a Playwright login, and it can be committed as a
   CI artifact rather than re-run.
3. **`login`** — a real sign-in through the form. It runs **once** per scenario,
   not once per page, and whatever cookies and storage it leaves behind are
   reused. A failing login stops the run with exit code 2.

Notes worth knowing:

- Keep credentials in environment variables. The config file gets committed.
- `include` and `exclude` decide which routes a scenario covers. Routes matched
  by no scenario are not tested, so make one scenario the default.
- If a signed-in page ends up on the login page, the run reports **HP9010**.
  That almost always means the login did not work, not that the page is broken.
- Reports can contain what a signed-in page shows. Redaction is on by default;
  see [security](../../docs/security.md).
