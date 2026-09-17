# Compatibility and stability

What you can build on, and what may change. From 1.0 on, everything in
**Stable** below follows [semver](https://semver.org/): it changes only in a
major release, with a migration path.

## What is stable

| Surface | Stable part |
| --- | --- |
| **CLI** | The commands, their flags and the [exit codes](cli.md#exit-codes). New flags are added; existing ones keep their meaning. |
| **Config** | Every documented option in [configuration.md](configuration.md), and `configVersion: 1`. Removing or renaming one needs a major release, and `hydration-proof migrate` keeps working for at least one major version. |
| **Report** | `report.json` with `schemaVersion: 1`, and `schema/report.json` describes it. Fields are added, never removed or repurposed. |
| **Issue codes** | An `HPxxxx` code keeps its meaning forever. A code is never reused for something else. |
| **Fingerprints** | Stable for a given `fingerprintVersion`, so baselines and ignore rules keep matching. |
| **Node API** | `run()`, `defineConfig`, `definePlugin`, `defineAdapter`, `mergeReports`, `ISSUES` and the types they use. |
| **Plugin and adapter API** | The fields in [plugins.md](plugins.md) and [adapters.md](adapters.md). |
| **Reporter output** | The JUnit, SARIF and GitLab shapes, as their own schemas define them. |

## What is not stable

These are internals. They change in minor releases, and nothing outside the
package should depend on them:

- everything under `src/` that the public exports do not re-export, including
  the capture stages, the mutation log, the rewind and the diff;
- the browser runtime and its protocol (it is rebuilt and inlined on every
  release, and both sides always ship together);
- the HTML report's markup and its embedded data;
- the exact wording of messages, the set of `evidence` entries, and confidence
  scores;
- **which** cause a finding is given, and whether a finding has a cause at all.
  Diagnosis improves over releases; treat a cause as an explanation for a human,
  not as something to assert on.

`severity` is in between: a code's severity can be lowered or raised in a minor
release when experience shows it was wrong. Pin the behaviour you care about
with [`ci.failOn` and `ci.budget`](ci.md) rather than relying on the defaults.

## Fingerprints and baselines

A fingerprint identifies a finding across runs, so a baseline recorded today
still matches tomorrow. It is built from the issue code, the route pattern, the
scenario and the element's position — never from values that change per request,
and never from anything redaction rewrites (fingerprints are computed first).

If a fix has to change how fingerprints are computed, `fingerprintVersion` in
the report is raised, the release notes say so, and `hydration-proof baseline`
rewrites your baseline. Old baselines keep working until you re-record: entries
with an older `fingerprintVersion` are matched by code, route and selector
instead.

## Supported versions

| | Supported |
| --- | --- |
| **Node.js** | 22.18 and later (it is the first version that imports `.ts` directly). Tested on 22.18, 24 and 26, on Linux, macOS and Windows. |
| **React** | 18.3 and 19.x, in development **and** production builds. React 18.0–18.2 are not tested; they hydrate differently enough that findings may be less precise. |
| **Next.js** | 15.5 and 16.x, App Router and Pages Router, webpack and Turbopack. The App Router always uses Next's own bundled React, so the installed React version only matters for the Pages Router. |
| **Other frameworks** | React Router v7 (framework mode), Remix v2, Astro with React islands, Vite SSR, and custom Node servers — see [adapters](adapters.md). |
| **Browsers** | Chromium, Firefox and WebKit through Playwright. Some options are Chromium-only ([matrix](configuration.md#matrix)). |
| **Playwright** | `playwright-core` 1.63 and later. Your own copy is used when it is new enough, so browsers are never downloaded twice. |
| **Package managers** | npm, pnpm, Yarn Classic, Yarn Berry (including Plug'n'Play) and Bun. Each is tested by installing the packed tarball into a fresh app and running the CLI against it. |
| **ESLint plugin** | `eslint ^9 || ^10`, flat config only. |

A version leaving this table is a major release. Adding one is not.

### How this is checked

Two workflows in the repository, so the table is a claim with evidence behind it:

- **`compat.yml`** runs the whole fixture suite again against other Next.js
  versions, and against React 18.3 and 19.0–19.3 for the Pages Router and
  custom SSR.
- **`real-world.yml`** runs against pinned open-source Next.js apps that nobody
  here wrote, which is the check that matters most: a tool that only works on
  its own fixtures is not a tool.

## Deprecation

When something stable has to go:

1. It keeps working, and using it prints a note naming the replacement.
2. `hydration-proof migrate` rewrites it where a rewrite is possible.
3. It is removed no earlier than the next major release.

Config options are the common case, and `migrate` covers them. Nothing is ever
removed in a patch release.

## Upgrading

```bash
npx hydration-proof migrate        # what this version renamed or replaced
npx hydration-proof migrate --write
```

Between minor versions, expect new findings: better detection is the point. If a
release starts reporting something you have decided to live with, an
[ignore rule](configuration.md#ignore) with a reason and an expiry date is the
honest way to park it, and `ci.newIssuesOnly` is the way to adopt a release
without a red pipeline on day one.
