import type { EnvironmentSplit, Issue, PageResult } from '../report/model.ts';

// "Only fails in production / in this locale / in this browser": for every
// route and scenario tested in several environments (matrix axes, build
// modes), find the axes whose values separate the pages that have a finding
// from the pages that do not.

const AXIS_TEXT: Record<string, string> = {
  locale: 'locale',
  timezone: 'timezone',
  colorScheme: 'color scheme',
  reducedMotion: 'reduced motion',
  viewport: 'viewport',
  browser: 'browser',
  network: 'network',
  cpu: 'CPU slowdown',
  cache: 'cache',
  mode: 'build',
};

function axesOf(page: PageResult): Record<string, string> {
  const axes: Record<string, string> = { ...page.environment };
  if (page.mode) axes['mode'] = page.mode;
  return axes;
}

export function describeSplit(splits: readonly EnvironmentSplit[]): string {
  const parts = splits.map((split) => {
    if (split.axis === 'mode') {
      return split.values.includes('production') ? 'the production build' : 'the development build (React development builds check more)';
    }
    return `${AXIS_TEXT[split.axis] ?? split.axis} ${split.values.join(' or ')}`;
  });
  if (parts.length === 1) return `Only found with ${parts[0]}.`;
  return `Only found with ${parts.join(', or with ')} (the tested combinations cannot tell which).`;
}

export function classifyEnvironments(pages: readonly PageResult[], issues: readonly Issue[]): void {
  const groups = new Map<string, PageResult[]>();
  for (const page of pages) {
    if (page.status === 'error') continue;
    // Path, not URL: the two builds of --mode both run on different ports.
    const url = new URL(page.url);
    const key = `${url.pathname}${url.search}|${page.baseScenario ?? page.scenario}`;
    const list = groups.get(key) ?? [];
    list.push(page);
    groups.set(key, list);
  }
  const byPage = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = `${issue.route.url}|${issue.scenario}|${issue.mode ?? ''}`;
    const list = byPage.get(key) ?? [];
    list.push(issue);
    byPage.set(key, list);
  }
  const issuesOf = (page: PageResult): Issue[] => byPage.get(`${page.url}|${page.scenario}|${page.mode ?? ''}`) ?? [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const fingerprints = new Set(group.flatMap((page) => issuesOf(page).map((issue) => issue.fingerprint)));
    for (const fingerprint of fingerprints) {
      const withIt = group.filter((page) => issuesOf(page).some((issue) => issue.fingerprint === fingerprint));
      const without = group.filter((page) => !withIt.includes(page));
      if (without.length === 0) continue;
      const names = new Set([...withIt, ...without].flatMap((page) => Object.keys(axesOf(page))));
      const splits: EnvironmentSplit[] = [];
      for (const axis of names) {
        const seenValues = new Set(withIt.map((page) => axesOf(page)[axis]));
        const otherValues = new Set(without.map((page) => axesOf(page)[axis]));
        if (seenValues.has(undefined) || otherValues.has(undefined)) continue;
        if ([...seenValues].some((value) => otherValues.has(value))) continue;
        splits.push({ axis, values: [...seenValues].map(String).sort() });
      }
      if (splits.length === 0) continue;
      const message = describeSplit(splits);
      for (const page of withIt) {
        for (const issue of issuesOf(page)) {
          if (issue.fingerprint !== fingerprint || issue.onlyIn) continue;
          issue.onlyIn = splits;
          issue.evidence.push({ kind: 'note', message });
        }
      }
    }
  }
}
