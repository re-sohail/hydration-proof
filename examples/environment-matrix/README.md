# Locales, timezones, themes, screens and browsers

Most hydration bugs are environment bugs: a date formatted with the browser's
locale, a theme read from `prefers-color-scheme`, a layout that only branches on
mobile. The matrix runs each scenario in combinations of environments and says
which axis a finding belongs to:

```text
/checkout  HP1001  #total — only in locale de-DE
```

**`strategy: 'pairwise'` is the default and is what you want.** Six axes with
three values each is 729 full combinations; pairwise covers every *pair* of
values in about a dozen runs, and pairs are what breaks. Use `full` only for a
handful of values, and `sample` with a `seed` when you want a fixed random
subset.

`max` is the ceiling per scenario (default 16), so adding an axis makes the runs
better rather than slower.

Things that are not available everywhere, and are skipped with a note rather
than failing:

- **`cpu`** throttling is Chromium only (it needs CDP).
- **`network`** delays subresources on Firefox and WebKit, but never the
  document itself, so a slow-network run there is weaker than on Chromium.
- **Mobile viewports** do not set `isMobile` on Firefox.

`cache: ['cold', 'warm']` is the cheap axis that finds the most: a warm cache
changes the order scripts arrive in, which changes when hydration starts.

Custom `axes` are for anything the tool cannot know — feature flags, a currency
cookie, an A/B bucket. Each value is scenario settings, so it can set cookies,
storage, headers or init scripts.
