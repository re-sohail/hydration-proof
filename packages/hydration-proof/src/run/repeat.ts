import type { Severity } from '../issues/registry.ts';
import type { Issue, PageResult } from '../report/model.ts';

// `repeat`: the same page is loaded several times. Findings that appear in
// only some of the runs are flaky; they still count (an intermittent
// mismatch is a real bug), and the page gets a flakiness score.

export interface RunResult {
  page: PageResult;
  issues: Issue[];
}

function signature(result: RunResult): string {
  if (result.page.status === 'error') return `error:${result.page.outcome}`;
  return result.issues
    .filter((issue) => !issue.ignored)
    .map((issue) => issue.fingerprint)
    .sort()
    .join(',');
}

/** Merge the runs of one page into a single result. `runs` is in run order. */
export function aggregateRuns(runs: readonly RunResult[]): RunResult {
  const first = runs[0];
  if (!first) throw new Error('aggregateRuns needs at least one run');
  if (runs.length === 1) return first;

  const completed = runs.filter((run) => run.page.status !== 'error');
  const seen = new Map<string, { issue: Issue; count: number }>();
  for (const run of completed) {
    for (const issue of run.issues) {
      const entry = seen.get(issue.fingerprint);
      if (entry) entry.count++;
      else seen.set(issue.fingerprint, { issue, count: 1 });
    }
  }
  const issues: Issue[] = [];
  for (const { issue, count } of seen.values()) {
    issue.occurrences = { seen: count, runs: completed.length };
    if (count < completed.length) {
      issue.flaky = true;
      issue.evidence.push({ kind: 'note', message: `Seen in ${count} of ${completed.length} runs of this page.` });
    }
    issues.push(issue);
  }

  const signatures = new Map<string, number>();
  for (const run of runs) signatures.set(signature(run), (signatures.get(signature(run)) ?? 0) + 1);
  const agreement = Math.max(...signatures.values()) / runs.length;

  // The page as the first completed run saw it, with the findings of all runs.
  const representative = completed[0] ?? first;
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) if (!issue.ignored) counts[issue.severity]++;
  const page: PageResult = {
    ...representative.page,
    issues: issues.map((issue) => issue.fingerprint),
    counts,
    runs: runs.length,
    flakiness: Math.round((1 - agreement) * 100) / 100,
  };
  page.status =
    completed.length === 0 ? 'error' : counts.error > 0 ? 'failed' : counts.warning > 0 ? 'warning' : 'passed';
  const logs = runs.flatMap((run) => run.page.serverLogs ?? []);
  if (logs.length > 0) page.serverLogs = [...new Set(logs)].slice(0, 20);
  return { page, issues };
}
