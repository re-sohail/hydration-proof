import type { Page } from 'playwright-core';
import type { NodeSource } from '../shared/protocol.ts';
import { appRenderer, type PageAnalysis } from '../analyze/index.ts';
import { causeDocsUrl, diagnose, type DiagnosisContext } from '../diagnose/index.ts';
import { componentFrames } from '../errors/react.ts';
import type { Issue } from '../report/model.ts';
import type { ResolvedFrame, SourceResolver } from '../source/resolve.ts';
import { isLibraryPath, SourceResolver as Resolver } from '../source/resolve.ts';
import type { PageCapture } from './capture.ts';
import { nodeSources, pageScripts } from './runtime-loader.ts';

// Adds component names, source locations and likely causes to the issues of
// a page, while the page is still open.

export interface EnrichOptions {
  rootDir: string;
  sourceMaps: boolean;
  diagnosis: Omit<DiagnosisContext, 'source' | 'headers'>;
}

const MINIFIED = /^[A-Za-z_$][\w$]?$/;

/** One resolver per run, so scripts and source maps are fetched once. */
export function createResolver(rootDir: string): SourceResolver {
  return new Resolver({
    rootDir,
    fetchText: async (url) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        return response.ok ? await response.text() : undefined;
      } catch {
        return undefined;
      }
    },
  });
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

interface Located {
  frame?: ResolvedFrame;
  /** Why no frame was found. */
  reason?: string;
}

async function locate(
  issue: Issue,
  source: NodeSource | undefined,
  resolver: SourceResolver,
  production: boolean,
  scripts: () => Promise<string[]>,
): Promise<Located> {
  for (const entry of source?.debugSources ?? []) {
    const resolved = resolver.fromFile(entry.fileName, entry.lineNumber, (entry.columnNumber ?? 1) - 1);
    if (resolved.absolute !== undefined && !isLibraryPath(resolved.absolute)) return { frame: resolved };
  }
  for (const stack of source?.stacks ?? []) {
    const resolved = await resolver.resolveCreationStack(stack);
    if (resolved) return { frame: resolved };
  }
  // Production: the component that rendered the element, found by its code.
  const functions = source?.functions ?? [];
  if (functions.length > 0) {
    const urls = await scripts();
    for (const text of functions) {
      const resolved = await resolver.resolveFunction(text, urls);
      if (resolved) return { frame: resolved };
    }
  }
  // The component stack React reported carries real code positions.
  const frames = componentFrames(issue.componentStack).filter((frame) => !(production && MINIFIED.test(frame.name) && frame.url === undefined));
  for (const frame of frames) {
    const resolved = await resolver.resolveFrame(frame);
    if (resolved) return { frame: resolved };
  }
  if (!production) return { reason: 'The element could not be mapped to a source file.' };
  const urls = [...new Set(frames.map((frame) => frame.url).filter((url) => url !== undefined))];
  const mapped = await Promise.all(urls.map((url) => resolver.hasSourceMap(url)));
  if (urls.length > 0 && !mapped.some(Boolean)) {
    return { reason: 'Production build without browser source maps. Run with --mode development, or enable productionBrowserSourceMaps.' };
  }
  return { reason: 'Source maps only led to framework or library code. Run with --mode development for the exact file and line.' };
}

export async function enrichIssues(
  page: Page,
  capture: PageCapture,
  analysis: PageAnalysis,
  resolver: SourceResolver | undefined,
  options: EnrichOptions,
): Promise<void> {
  const production = appRenderer(capture)?.bundleType === 0;
  const ids = [...new Set(analysis.nodes.values())];
  let sources = new Map<number, NodeSource>();
  if (ids.length > 0) {
    try {
      sources = new Map((await nodeSources(page, ids)).map((entry) => [entry.id, entry]));
    } catch {
      sources = new Map();
    }
  }

  let scriptList: Promise<string[]> | undefined;
  const scripts = (): Promise<string[]> => (scriptList ??= pageScripts(page).catch(() => []));

  const contents = new Map<string, ResolvedFrame>();
  for (const issue of analysis.issues) {
    const nodeId = analysis.nodes.get(issue.fingerprint);
    const source = nodeId !== undefined ? sources.get(nodeId) : undefined;

    if (source && source.owners.length > 0) {
      const usable = source.owners.filter((name) => !(production && MINIFIED.test(name)));
      if (usable.length > 0) {
        issue.component ??= usable[0];
        if (!issue.componentStack && !production) issue.componentStack = usable.map((name) => `at ${name}`).join('\n');
      }
    }

    let located: Located = {};
    if (resolver && options.sourceMaps && (issue.stage !== 'parsed' || source !== undefined)) {
      located = await locate(issue, source, resolver, production, scripts).catch(() => ({}));
    }
    const resolved = located.frame;
    if (resolved) {
      issue.source = { file: resolved.file, line: resolved.line };
      if (resolved.column !== undefined) issue.source.column = resolved.column;
      if (resolved.frame !== undefined) issue.source.frame = resolved.frame;
      delete issue.sourceUnavailableReason;
      contents.set(issue.fingerprint, resolved);
    } else if (issue.stage === 'parsed') {
      issue.sourceUnavailableReason = 'The location is in the server HTML (see the line and column in the message).';
    } else if (!options.sourceMaps) {
      issue.sourceUnavailableReason = 'Source mapping is turned off.';
    } else {
      issue.sourceUnavailableReason = located.reason ?? 'The element could not be mapped to a source file.';
    }

    const content = contents.get(issue.fingerprint);
    const context: DiagnosisContext = { ...options.diagnosis };
    if (capture.document?.headers) context.headers = capture.document.headers;
    if (content?.content !== undefined) {
      context.source = { content: content.content, line: content.line, file: content.file };
      if (content.scope) context.source.scope = content.scope;
    }
    const result = diagnose(issue, context);
    if (result.cause) issue.cause = { ...result.cause, docsUrl: causeDocsUrl(result.cause.id) };
    if (result.evidence.length > 0) issue.evidence = [...result.evidence, ...issue.evidence];
    if (result.suggestions.length > 0) issue.suggestions = dedupeStrings([...result.suggestions, ...issue.suggestions]);
    if (result.severity !== undefined && !issue.ignored) issue.severity = result.severity;
  }
}
