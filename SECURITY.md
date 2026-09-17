# Security

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/re-sohail/hydration-proof/security/advisories/new),
not in public issues. Include the version, the command you ran and, if you can,
a fixture or app that shows the problem. You will get a first reply within a
week.

Security fixes are released for the latest minor version.

## Supported design

[`docs/security.md`](docs/security.md) is the full account of what
hydration-proof does with your app's data. The short version:

- It runs only on your machine or CI runner and uploads nothing. There is no
  telemetry, and the package has no install scripts.
- Its requests go to the app you are testing. Scripts and source maps are only
  fetched from the app's own origin, plus any origin you list in
  `sourceOrigins`.
- `hydration-proof install` downloads browsers through Playwright's installer.
  Your own build and server commands run as you wrote them.
- Reports can contain page text, attribute values, URLs and screenshots of the
  tested app, so treat them like test artifacts of that app. Emails, tokens,
  keys, card numbers and secret URL parameters are redacted by default.
- The `ui` dashboard listens on `127.0.0.1`, requires a per-run token and
  refuses unexpected `Host` and `Origin` headers. Do not forward its port.
