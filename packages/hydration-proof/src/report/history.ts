import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Severity } from '../issues/registry.ts';
import type { HistoryEntry, Report } from './model.ts';

// Trend file: one JSON line per run (NDJSON), appended after every run.

export const HISTORY_LIMIT = 30;

export function historyEntry(report: Report): HistoryEntry {
  const codes: Record<string, number> = {};
  const issues: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const fingerprints = new Set<string>();
  for (const issue of report.issues) {
    if (issue.ignored) continue;
    codes[issue.code] = (codes[issue.code] ?? 0) + 1;
    issues[issue.severity]++;
    fingerprints.add(issue.fingerprint);
  }
  const entry: HistoryEntry = {
    date: report.run.finishedAt,
    durationMs: report.run.durationMs,
    pages: report.summary.pages,
    failed: report.summary.failed + report.summary.errored,
    issues,
    codes,
    fingerprints: [...fingerprints].sort(),
  };
  if (report.run.commit !== undefined) entry.commit = report.run.commit;
  if (report.run.branch !== undefined) entry.branch = report.run.branch;
  return entry;
}

export function readHistory(file: string, limit: number = HISTORY_LIMIT): HistoryEntry[] {
  if (!existsSync(file)) return [];
  const entries: HistoryEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as HistoryEntry;
      if (typeof entry.date === 'string' && entry.issues) entries.push(entry);
    } catch {
      // A broken line (for example from an interrupted write) is skipped.
    }
  }
  return entries.slice(-limit);
}

export function appendHistory(file: string, entry: HistoryEntry): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
