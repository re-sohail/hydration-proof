import type { Adapter } from '../adapters/index.ts';
import type { Draft } from '../analyze/draft.ts';
import { applyIgnores, type ExpiredRule } from '../analyze/ignore.ts';
import { issuesFromDrafts } from '../analyze/index.ts';
import type { ResolvedConfig, ResolvedScenario } from '../config/resolve.ts';
import type { BuildMode } from '../config/types.ts';
import type { NormalizeOptions } from '../dom/normalize.ts';
import type { ScenarioSpec } from '../engine/context.ts';
import { checkEarlyClick, checkEarlyInput, runCustomInteraction, type InteractionOutcome } from '../engine/interactions.ts';
import { checkNavigation } from '../engine/navigation.ts';
import { mapConcurrent } from '../engine/pool.ts';
import type { BrowserSource, EngineOptions, PageJob } from '../engine/run.ts';
import type { Severity } from '../issues/registry.ts';
import type { Issue, PageResult, TimelineEntry } from '../report/model.ts';
import { matchesAny } from '../routes/pattern.ts';
import type { PlannedRoute, RoutePlan } from './plan.ts';

// Checks that run after the main pass: interactions (built-in and from the
// config) and client-side navigation.

export interface CheckedJob {
  job: PageJob;
  route: PlannedRoute;
  scenario: ResolvedScenario;
}

export interface LateChecksInput {
  config: ResolvedConfig;
  adapter: Adapter;
  browsers: BrowserSource;
  engine: EngineOptions;
  normalize: NormalizeOptions;
  baseUrl: string;
  mode: BuildMode | undefined;
  plan: RoutePlan;
  /** Pages of this server, with the job each came from. */
  pages: readonly { page: PageResult; planned: CheckedJob }[];
  allIssues: Issue[];
  expired: ExpiredRule[];
  notes: string[];
  write(text: string): void;
  /** Owners and baseline state for new findings. */
  prepare?(issues: Issue[]): void;
}

function fixed(scenario: ScenarioSpec, clock: number): ScenarioSpec {
  return { ...scenario, clock: scenario.clock ?? clock, randomSeed: scenario.randomSeed ?? 1 };
}

/** Path and query of a full URL. */
function pathAndQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

const hydratedOutcome = (page: PageResult): boolean => page.outcome === 'hydrated' || page.outcome === 'hydration-stalled';

function recount(page: PageResult, issues: readonly Issue[]): void {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) if (!issue.ignored) counts[issue.severity]++;
  page.counts = counts;
  if (page.status !== 'error') page.status = counts.error > 0 ? 'failed' : counts.warning > 0 ? 'warning' : 'passed';
}

export async function runLateChecks(input: LateChecksInput): Promise<void> {
  const { config, adapter } = input;
  const interactions = config.checks.interactions;
  const navigation = config.checks.navigation !== false && adapter.navigation ? config.checks.navigation : false;
  if (config.checks.navigation !== false && !adapter.navigation) {
    input.notes.push('Navigation checks need a framework adapter with a client router (Next.js); they were skipped.');
  }
  const custom = config.interactions;
  if (!interactions && !navigation && custom.length === 0) return;

  const candidates = input.pages.filter(({ page, planned }) => hydratedOutcome(page) && page.status !== 'error' && planned.route.source !== 'not-found');
  if (candidates.length === 0) return;
  const clock = Math.floor(Date.now() / 60_000) * 60_000;
  const skipped = new Map<string, number>();
  let idle = 0;
  const skip = (reason: string | undefined): void => {
    if (reason !== undefined) skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };

  // Navigation targets: at most maxRoutes per scenario.
  const navigationTargets = new Set<PageResult>();
  if (navigation) {
    const perScenario = new Map<string, number>();
    for (const { page, planned } of candidates) {
      if (pathAndQuery(page.finalUrl) !== pathAndQuery(page.url)) continue; // redirected routes
      const count = perScenario.get(page.scenario) ?? 0;
      if (count >= navigation.maxRoutes) continue;
      perScenario.set(page.scenario, count + 1);
      navigationTargets.add(page);
    }
  }

  const loads = { interactions: 0, navigation: 0, custom: 0 };
  input.write(`  Running ${[interactions ? 'interaction' : '', navigation ? 'navigation' : '', custom.length ? 'custom interaction' : ''].filter(Boolean).join(', ')} checks...\n`);
  const concurrency = Math.max(1, Math.floor(input.engine.workers / 2));
  await mapConcurrent(candidates, concurrency, async ({ page, planned }) => {
    const browser = await input.browsers(planned.job.scenario.browser);
    const ready = { ...input.engine.ready, ...planned.job.ready };
    const scenario = fixed(planned.job.scenario, clock);
    const options = { ready, scenario };
    const drafts: Draft[] = [];
    const timeline: TimelineEntry[] = [];
    const collect = (outcome: InteractionOutcome): void => {
      drafts.push(...outcome.drafts);
      skip(outcome.skipped);
      if (outcome.idle) idle++;
    };

    if (interactions) {
      collect(await checkEarlyInput(browser, page.url, options));
      collect(await checkEarlyClick(browser, page.url, options));
      loads.interactions += 6;
    }
    const path = new URL(page.url).pathname;
    for (const interaction of custom) {
      const matches = matchesAny(path, [interaction.route]) || matchesAny(planned.route.pattern, [interaction.route]);
      if (!matches) continue;
      if (interaction.scenarios && !interaction.scenarios.includes(planned.scenario.base) && !interaction.scenarios.includes(planned.scenario.name)) continue;
      collect(await runCustomInteraction(browser, page.url, input.baseUrl, interaction, { ready, scenario: planned.job.scenario }));
      loads.custom++;
    }
    if (navigation && navigationTargets.has(page)) {
      let from = planned.route.navigateFrom ?? navigation.from ?? '/';
      if (from === path) {
        const other = candidates.find(
          (entry) =>
            entry.page.scenario === page.scenario &&
            new URL(entry.page.url).pathname !== path &&
            pathAndQuery(entry.page.finalUrl) === pathAndQuery(entry.page.url),
        );
        from = other ? new URL(other.page.url).pathname : '';
      }
      if (from === '') {
        skip('there is no other page to navigate from');
      } else {
        const fromUrl = new URL(from, `${input.baseUrl}/`);
        for (const [key, value] of Object.entries(planned.scenario.query)) fromUrl.searchParams.set(key, value);
        const flags = input.plan.flags[planned.route.pattern];
        const outcome = await checkNavigation(browser, fromUrl.href, page.url, {
          ready,
          scenario,
          navigation: adapter.navigation!,
          normalize: input.normalize,
          prefetch: navigation.prefetch,
          ...(flags?.intercepted ? { expectDifferences: 'intercepted' as const } : flags?.parallel ? { expectDifferences: 'parallel' as const } : {}),
        });
        collect(outcome);
        timeline.push(...outcome.timeline);
        loads.navigation += navigation.prefetch ? 3 : 2;
      }
    }

    // Times of the navigation check are relative to its own page load.
    if (timeline.length > 0) {
      const own = [...timeline].sort((a, b) => a.time - b.time).map((entry) => ({ ...entry, detail: entry.detail ? `${entry.detail} (navigation check)` : 'navigation check' }));
      page.timeline = [...(page.timeline ?? []), ...own];
    }
    if (drafts.length === 0) return;
    const issues = issuesFromDrafts(drafts, { route: page.route, scenario: page.scenario });
    for (const issue of issues) if (input.mode) issue.mode = input.mode;
    input.expired.push(...applyIgnores(issues, { textPatterns: config.ignore.textPatterns, rules: config.ignore.issues }));
    input.prepare?.(issues);
    const known = new Set(page.issues);
    const added = issues.filter((issue) => !known.has(issue.fingerprint));
    input.allIssues.push(...added);
    page.issues = [...page.issues, ...added.map((issue) => issue.fingerprint)];
    const pageIssues = input.allIssues.filter(
      (issue) => issue.route.url === page.url && issue.scenario === page.scenario && issue.mode === page.mode && page.issues.includes(issue.fingerprint),
    );
    recount(page, pageIssues);
  });

  const total = loads.interactions + loads.navigation + loads.custom;
  input.notes.push(
    `Interaction and navigation checks: ${candidates.length} page${candidates.length === 1 ? '' : 's'}, about ${total} extra page loads${idle > 0 ? `; ${idle} interaction check${idle === 1 ? '' : 's'} found no field, button or scrollable content to try` : ''}.`,
  );
  if (skipped.size > 0) {
    const reasons = [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([reason, count]) => `${reason} (${count})`);
    input.notes.push(`Some checks could not run: ${reasons.join('; ')}.`);
  }
}
