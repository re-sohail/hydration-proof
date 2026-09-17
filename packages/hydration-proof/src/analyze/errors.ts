import type { CapturedError } from '../shared/protocol.ts';
import type { IssueCode } from '../issues/registry.ts';
import type { Evidence } from '../report/model.ts';
import { classifyReactMessage, componentFrames, type ReactMessage } from '../errors/react.ts';
import type { Draft } from './draft.ts';

// React's own reports. They are attached as evidence to DOM findings from the
// same commit; only reports nothing else explains become issues of their own.

export interface ReactReport {
  message: ReactMessage;
  error: CapturedError;
  evidence: Evidence;
}

export interface ErrorAnalysis {
  reports: ReactReport[];
  /** Page errors unrelated to hydration. */
  drafts: Draft[];
}

const SOURCE_PRIORITY: Record<CapturedError['source'], number> = {
  recoverable: 0,
  caught: 1,
  uncaught: 2,
  'console-error': 3,
  'report-error': 4,
  'window-error': 5,
  'unhandled-rejection': 6,
  'console-warn': 7,
};

function firstLine(text: string, max = 240): string {
  const line = text.split('\n')[0] ?? text;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function group(errors: CapturedError[]): CapturedError[] {
  const byKey = new Map<string, CapturedError[]>();
  for (const error of errors) {
    const key = error.errorId !== undefined ? `id:${error.errorId}` : `${error.source}:${error.message}`;
    const list = byKey.get(key) ?? [];
    list.push(error);
    byKey.set(key, list);
  }
  return [...byKey.values()].map((list) =>
    list.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])[0]!,
  );
}

function classify(error: CapturedError): ReactMessage | undefined {
  return classifyReactMessage(error.message) ?? (error.cause ? classifyReactMessage(error.cause.message) : undefined);
}

export function isWarningKind(message: ReactMessage): boolean {
  return (
    message.kind === 'attribute-warning' ||
    message.kind === 'text-warning' ||
    message.kind === 'structure-warning' ||
    message.kind === 'nesting-warning'
  );
}

export function analyzeErrors(errors: CapturedError[]): ErrorAnalysis {
  const reports: ReactReport[] = [];
  const drafts: Draft[] = [];
  for (const error of group(errors)) {
    const message = classify(error);
    if (message) {
      const code = message.code !== undefined ? ` (React error #${message.code})` : '';
      const cause = error.cause && !classifyReactMessage(error.cause.message) ? ` Caused by: ${firstLine(error.cause.message, 160)}` : '';
      const evidence: Evidence = {
        kind: isWarningKind(message) ? 'react-warning' : 'react-error',
        message: `${firstLine(error.message)}${code}${cause}`,
      };
      if (error.componentStack) evidence.detail = error.componentStack.trim();
      reports.push({ message, error, evidence });
      continue;
    }
    if (error.source === 'console-error' || error.source === 'console-warn') continue;
    drafts.push({
      code: 'HP2007',
      stage: 'runtime',
      confidence: 0.5,
      message: firstLine(`${error.name ? `${error.name}: ` : ''}${error.message}`),
      evidence: [{ kind: 'page-error', message: firstLine(error.message), ...(error.stack ? { detail: error.stack } : {}) }],
      key: firstLine(error.message, 120),
    });
  }
  return { reports, drafts };
}

/** A standalone issue for a React report that no DOM finding explains. */
export function standaloneDraft(report: ReactReport): Draft | undefined {
  const { message } = report;
  let code: IssueCode;
  switch (message.kind) {
    case 'hydration-failed':
    case 'text-mismatch':
      code = 'HP2001';
      break;
    case 'root-client-render':
      code = 'HP2004';
      break;
    case 'boundary-client-render':
      code = 'HP2003';
      break;
    case 'server-render-failed':
      code = 'HP2006';
      break;
    case 'early-update':
      code = 'HP2005';
      break;
    case 'nesting-warning':
      code = 'HP3001';
      break;
    case 'duplicate-stylesheet':
      return undefined;
    default:
      code = 'HP2002';
  }
  const frames = componentFrames(report.error.componentStack);
  const draft: Draft = {
    code,
    stage: 'runtime',
    confidence: 0.6,
    message: report.evidence.message,
    evidence: [report.evidence],
    key: `${message.kind}:${message.childTag ?? ''}:${message.parentTag ?? ''}:${message.prop ?? ''}`,
  };
  if (report.error.componentStack) draft.componentStack = report.error.componentStack.trim();
  if (frames[0]) draft.component = frames[0].name;
  if (message.server !== undefined) draft.server = message.server;
  if (message.client !== undefined) draft.client = message.client;
  if (message.prop !== undefined) draft.attribute = message.prop;
  if (report.error.commit !== undefined) draft.commit = report.error.commit;
  return draft;
}
