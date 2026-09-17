import type { CommitInfo } from '../shared/protocol.ts';
import type { PageCapture } from '../engine/capture.ts';
import type { ParsedDocument } from '../engine/parse-stage.ts';
import { DEFAULT_NORMALIZE, type NormalizeOptions } from '../dom/normalize.ts';
import { isElement, walk } from '../dom/tree.ts';
import { fingerprint } from '../issues/fingerprint.ts';
import { docsUrl, issueDefinition, type Severity } from '../issues/registry.ts';
import { suggestionsFor } from '../issues/suggestions.ts';
import type { Issue, PageStatus, ReactInfo, RouteRef, TimelineEntry } from '../report/model.ts';
import type { Draft } from './draft.ts';
import { analyzeDuplicateIds, analyzeHead } from './document.ts';
import { analyzeErrors, isWarningKind, standaloneDraft, type ReactReport } from './errors.ts';
import { analyzeExternal } from './external.ts';
import { analyzeHydration } from './hydration.ts';
import { analyzeMarkup } from './markup.ts';
import { analyzeOutcome } from './outcome.ts';
import { buildTimeline } from './timeline.ts';

export interface AnalyzeOptions {
  route: RouteRef;
  scenario: string;
  normalize?: NormalizeOptions;
  /** Report suppressHydrationWarning that suppresses nothing (HP6003). */
  reportUnusedSuppression?: boolean;
  /** HTTP statuses that are expected for this route. */
  expectedStatuses?: readonly number[];
  /** Compare attributes and text with what React renders on the client. Default true. */
  propsAudit?: boolean;
  /** The path the route must redirect to. */
  expectRedirect?: string;
}

export interface PageAnalysis {
  issues: Issue[];
  status: PageStatus;
  react?: ReactInfo;
  /** Issue fingerprint -> element id in the live page. */
  nodes: Map<string, number>;
  timeline: TimelineEntry[];
}

const STRUCTURAL = new Set(['HP1001', 'HP1007', 'HP1008', 'HP1009', 'HP1015', 'HP1010', 'HP1011']);

function commitFor(report: ReactReport, commits: CommitInfo[]): number | undefined {
  const { error } = report;
  const fromCallback = error.source === 'recoverable' || error.source === 'caught' || error.source === 'uncaught';
  if (fromCallback && error.commit !== undefined) return error.commit;
  // Console output is logged while React renders, i.e. before its commit.
  const next = commits.find((commit) => commit.kind !== 'update' && commit.time >= error.time);
  return next?.seq ?? error.commit;
}

function sameAnchor(draft: Draft, anchors: readonly string[]): boolean {
  return anchors.some(
    (anchor) =>
      draft.anchor === anchor ||
      draft.nodeAnchors?.includes(anchor) === true ||
      (draft.selector !== undefined && (draft.selector === anchor || draft.selector.startsWith(`${anchor} `))),
  );
}

function absorb(target: Draft, source: Draft): void {
  for (const entry of source.evidence) {
    if (!target.evidence.some((existing) => existing.message === entry.message)) target.evidence.push(entry);
  }
  if (source.message !== target.message) {
    target.evidence.push({ kind: 'dom-change', message: source.message });
  }
  target.component ??= source.component;
  target.componentStack ??= source.componentStack;
  target.commit ??= source.commit;
}

function merge(drafts: Draft[], reports: ReactReport[], commits: CommitInfo[]): Draft[] {
  const markup = drafts.filter((draft) => draft.code === 'HP3001' || draft.code === 'HP3002');
  const external = drafts.filter((draft) => draft.code === 'HP4001' || draft.code === 'HP4002');
  const dropped = new Set<Draft>();

  // 1. Structural differences caused by invalid nesting belong to the markup issue.
  for (const issue of markup) {
    const anchors = issue.related ?? (issue.anchor ? [issue.anchor] : []);
    if (anchors.length === 0) continue;
    for (const draft of drafts) {
      if (draft === issue || dropped.has(draft) || !STRUCTURAL.has(draft.code)) continue;
      if (sameAnchor(draft, anchors)) {
        absorb(issue, draft);
        dropped.add(draft);
      }
    }
  }

  // 2. Hydration differences on elements a script changed first belong to that change.
  for (const issue of external) {
    if (!issue.anchor) continue;
    for (const draft of drafts) {
      if (draft === issue || dropped.has(draft) || draft.stage !== 'hydration') continue;
      if (!sameAnchor(draft, [issue.anchor])) continue;
      const sameValue = draft.server !== undefined && draft.server === issue.client;
      const sameAttribute = draft.attribute !== undefined && draft.attribute === issue.attribute;
      if (sameValue || sameAttribute || STRUCTURAL.has(draft.code)) {
        absorb(issue, draft);
        dropped.add(draft);
      }
    }
  }

  const kept = drafts.filter((draft) => !dropped.has(draft));

  // 3. React's own reports become evidence for findings of the same commit.
  for (const report of reports) {
    const commit = commitFor(report, commits);
    let targets = kept.filter((draft) => draft.commit !== undefined && draft.commit === commit);
    if (report.message.kind === 'nesting-warning') {
      const nesting = kept.filter((draft) => draft.code === 'HP3001' || draft.code === 'HP3002');
      if (nesting.length > 0) targets = nesting;
    }
    if (targets.length === 0) {
      // Fold into a markup/external issue when those explain the commit's failure.
      const explained = [...markup, ...external].filter((draft) => !dropped.has(draft) && draft.severity !== 'info');
      if (explained.length > 0 && !isWarningKind(report.message)) targets = explained.slice(0, 1);
    }
    if (targets.length === 0) {
      const standalone = standaloneDraft(report);
      if (standalone) kept.push(standalone);
      continue;
    }
    const primary = targets[0]!;
    if (!primary.evidence.some((entry) => entry.message === report.evidence.message)) primary.evidence.push(report.evidence);
    if (report.error.componentStack && !primary.componentStack) {
      primary.componentStack = report.error.componentStack.trim();
    }
  }
  return kept;
}

/**
 * Production builds minify component names (`x`, `Ab`). Such names are noise
 * in a report, so they are dropped with an explanation.
 */
function usableComponent(name: string | undefined, production: boolean): string | undefined {
  if (name === undefined) return undefined;
  if (production && /^[A-Za-z_$][\w$]?$/.test(name)) return undefined;
  return name;
}

function toIssue(draft: Draft, options: AnalyzeOptions, production: boolean): Issue {
  const definition = issueDefinition(draft.code);
  const input: Parameters<typeof fingerprint>[0] = { code: draft.code, routePattern: options.route.pattern };
  if (draft.selector !== undefined) input.selector = draft.selector;
  if (draft.attribute !== undefined) input.attribute = draft.attribute;
  if (draft.key !== undefined && draft.selector === undefined) input.key = draft.key;
  const issue: Issue = {
    fingerprint: fingerprint(input),
    code: draft.code,
    title: definition.title,
    severity: draft.severity ?? definition.severity,
    confidence: Math.round(draft.confidence * 100) / 100,
    message: draft.message,
    route: options.route,
    scenario: options.scenario,
    stage: draft.stage,
    evidence: draft.evidence,
    suggestions: suggestionsFor(draft.code),
    docsUrl: docsUrl(draft.code),
  };
  if (draft.selector !== undefined) issue.selector = draft.selector;
  if (draft.domPath !== undefined) issue.domPath = draft.domPath;
  if (draft.attribute !== undefined) issue.attribute = draft.attribute;
  if (draft.server !== undefined) issue.server = draft.server;
  if (draft.client !== undefined) issue.client = draft.client;
  const component = usableComponent(draft.component, production);
  if (component !== undefined) issue.component = component;
  if (draft.componentStack !== undefined) issue.componentStack = draft.componentStack;
  if (draft.suppressed) issue.suppressed = true;
  if (draft.excerpt && (draft.excerpt.server !== undefined || draft.excerpt.client !== undefined)) issue.excerpt = draft.excerpt;
  if (draft.ignoredBy !== undefined) {
    issue.ignored = { reason: `Inside an element matching ${draft.ignoredBy}.`, rule: 'ignore.selectors' };
  }
  if (issue.source === undefined) {
    issue.sourceUnavailableReason = production
      ? 'Production builds minify component names and code. Run with --mode development for component names and source locations.'
      : 'Source mapping is not enabled in this version.';
  }
  return issue;
}

/** Issues from findings made outside the page analysis (interaction and navigation checks). */
export function issuesFromDrafts(drafts: readonly Draft[], options: Pick<AnalyzeOptions, 'route' | 'scenario'>, production = false): Issue[] {
  return dedupe(drafts.map((draft) => {
    const issue = toIssue(draft, options, production);
    delete issue.sourceUnavailableReason;
    return issue;
  }));
}

function dedupe(issues: Issue[]): Issue[] {
  const byFingerprint = new Map<string, Issue>();
  for (const issue of issues) {
    const existing = byFingerprint.get(issue.fingerprint);
    if (!existing) {
      byFingerprint.set(issue.fingerprint, issue);
      continue;
    }
    for (const entry of issue.evidence) {
      if (!existing.evidence.some((known) => known.message === entry.message)) existing.evidence.push(entry);
    }
    existing.confidence = Math.max(existing.confidence, issue.confidence);
  }
  return [...byFingerprint.values()];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function pageStatus(capture: PageCapture, issues: Issue[]): PageStatus {
  if (capture.outcome === 'navigation-failed') return 'error';
  const active = issues.filter((issue) => !issue.ignored);
  if (active.some((issue) => issue.severity === 'error')) return 'failed';
  if (active.some((issue) => issue.severity === 'warning')) return 'warning';
  return 'passed';
}

/** The renderer the app hydrates with (dev tooling may bring its own React). */
export function appRenderer(capture: PageCapture): PageCapture['runtime']['renderers'][number] | undefined {
  const { renderers, roots } = capture.runtime;
  const appRoot = roots.find((root) => !root.tooling && root.mode === 'hydrate') ?? roots.find((root) => !root.tooling);
  return renderers.find((renderer) => renderer.id === appRoot?.rendererId) ?? renderers[0];
}

function reactInfo(capture: PageCapture): ReactInfo | undefined {
  const renderer = appRenderer(capture);
  if (!renderer) return undefined;
  return {
    version: renderer.version,
    build: renderer.bundleType === 0 ? 'production' : renderer.bundleType === 1 ? 'development' : 'unknown',
    roots: capture.runtime.roots.filter((root) => !root.tooling).map((root) => ({ selector: root.containerSelector, mode: root.mode })),
  };
}

export function analyzePage(capture: PageCapture, parsed: ParsedDocument | undefined, options: AnalyzeOptions): PageAnalysis {
  const normalize = options.normalize ?? DEFAULT_NORMALIZE;
  const { runtime } = capture;
  const drafts: Draft[] = [...analyzeOutcome(capture, options.expectedStatuses ?? [], options.expectRedirect)];

  const errorAnalysis = analyzeErrors(runtime.errors);
  drafts.push(...errorAnalysis.drafts);

  const containers = new Set(runtime.roots.filter((root) => !root.tooling).map((root) => root.container));
  const hydration = analyzeHydration({
    commits: runtime.commits,
    batches: runtime.batches,
    snapshots: runtime.snapshots,
    containers,
    normalize,
    reportUnusedSuppression: options.reportUnusedSuppression ?? false,
    propsAudit: options.propsAudit ?? true,
  });
  drafts.push(...hydration.drafts);

  const body = capture.document?.body;
  if (parsed && body !== undefined) {
    drafts.push(...analyzeMarkup(body, parsed.tree));
    const first = hydration.events[0];
    if (first) {
      const snapshot = runtime.snapshots.find((entry) => entry.seq === first.commit.snapshot);
      const reactOwned = new Set<number>();
      if (snapshot) {
        walk(snapshot.tree, (node) => {
          if (isElement(node) && node.client) reactOwned.add(node.id);
        });
      }
      const streamBatches = runtime.batches.filter(
        (batch) => batch.phase === 'react-stream' && batch.time <= first.commit.time,
      );
      drafts.push(
        ...analyzeExternal({
          parsed: parsed.tree,
          preHydration: first.preTree,
          streamBatches,
          normalize,
          reactOwned,
          documentLoading: first.commit.readyState === 'loading',
          containers,
        }),
      );
    }
  }

  const firstEvent = hydration.events[0];
  const postEffect = runtime.snapshots.find((entry) => entry.seq === capture.postEffectSnapshot);
  if (firstEvent && postEffect) drafts.push(...analyzeHead(firstEvent.preTree, postEffect.tree, normalize));
  const finalSnapshot = runtime.snapshots.find((entry) => entry.seq === capture.stableSnapshot) ?? postEffect;
  if (finalSnapshot && runtime.roots.some((root) => !root.tooling)) {
    drafts.push(...analyzeDuplicateIds(finalSnapshot.tree, runtime.roots, normalize));
  }

  const merged = merge(drafts, errorAnalysis.reports, runtime.commits);
  const production = appRenderer(capture)?.bundleType === 0;
  const nodes = new Map<string, number>();
  // Markup findings point into the parsed copy; find the same element (by
  // unique id) in the live page so its source can be looked up.
  const liveIds = new Map<string, number>();
  const firstSnapshot = hydration.events[0] ? runtime.snapshots.find((entry) => entry.seq === hydration.events[0]!.commit.snapshot) : undefined;
  if (firstSnapshot) {
    walk(firstSnapshot.tree, (node) => {
      if (!isElement(node)) return;
      const id = node.attrs.find(([name]) => name === 'id')?.[1];
      if (id !== undefined) liveIds.set(`#${id}`, liveIds.has(`#${id}`) ? -1 : node.id);
    });
  }
  const converted = merged.map((draft) => {
    const issue = toIssue(draft, options, production);
    if (draft.nodeId !== undefined && draft.stage !== 'parsed' && !nodes.has(issue.fingerprint)) nodes.set(issue.fingerprint, draft.nodeId);
    if (draft.stage === 'parsed' && draft.anchor !== undefined) {
      const live = liveIds.get(draft.anchor);
      if (live !== undefined && live > 0) nodes.set(issue.fingerprint, live);
    }
    return issue;
  });
  const issues = dedupe(converted).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );
  const analysis: PageAnalysis = { issues, status: pageStatus(capture, issues), nodes, timeline: buildTimeline(runtime, capture.network, capture.timeOrigin) };
  const react = reactInfo(capture);
  if (react) analysis.react = react;
  return analysis;
}
