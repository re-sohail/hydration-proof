# eslint-plugin-hydration-proof

## 0.9.0

No changes in this release.

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

### Minor Changes

- New package: `eslint-plugin-hydration-proof`, rules that catch hydration mismatches while you write code.
  
  - 15 rules for render code: `no-date-in-render`, `no-random-in-render`, `no-browser-global-in-render`, `no-storage-in-initial-render`, `no-match-media-in-render`, `no-locale-without-explicit-locale`, `no-timezone-without-explicit-timezone`, `no-unstable-id`, `no-global-render-counter`, `no-window-render-branch`, `no-invalid-interactive-nesting`, `audit-suppress-hydration-warning`, `no-client-only-initial-state`, `require-stable-server-snapshot` and `require-deterministic-list-order`.
  - Render-scope analysis: component and hook bodies, state initializers, `useMemo` and array callbacks count as render code; effects and event handlers do not. Each problem is reported by exactly one rule.
  - Presets for flat config: `recommended`, `next` (skips Next.js Server Components) and `strict`.
  - Suggestions only where the change is mechanical (for example an explicit locale or timeZone); business logic is never rewritten.
  - No runtime dependencies; works with ESLint 9 and 10.

## 0.4.0

No changes in this release.
