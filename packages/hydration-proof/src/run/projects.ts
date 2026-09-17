import { relative } from 'node:path';
import { palette } from '../cli/style.ts';
import { ExitCode } from '../ci/exit-codes.ts';
import type { CliOverrides, ResolvedConfig } from '../config/resolve.ts';
import { copyScreenshots, mergeReports, type MergeInput } from '../report/merge.ts';
import type { Report } from '../report/model.ts';
import { createReporters, type Reporter } from '../report/reporters/index.ts';
import { RunError } from './errors.ts';

// Monorepos: every project is tested with its own config, one after the
// other, and the root writes one combined report.

export interface ProjectRunOptions {
  cwd: string;
  config?: string;
  overrides: CliOverrides;
  write: (text: string) => void;
  reporters: Reporter[];
  signal?: AbortSignal;
}

export interface ProjectRunResult {
  report: Report;
  exitCode: ExitCode;
  failures: string[];
  files: string[];
  notes: string[];
  outputDir: string;
}

/** Exit code of several runs: problems running beat findings. */
function worst(codes: readonly ExitCode[]): ExitCode {
  return codes.find((code) => code !== ExitCode.Ok && code !== ExitCode.Failed) ?? (codes.includes(ExitCode.Failed) ? ExitCode.Failed : ExitCode.Ok);
}

export async function runProjects(
  root: ResolvedConfig,
  runProject: (options: ProjectRunOptions) => Promise<ProjectRunResult>,
  options: { overrides: CliOverrides; write: (text: string) => void; reporters: Reporter[]; signal?: AbortSignal },
): Promise<ProjectRunResult> {
  const c = palette(process.stdout);
  const inputs: MergeInput[] = [];
  const codes: ExitCode[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  const overrides: CliOverrides = { ...options.overrides };
  delete overrides.projects;
  delete overrides.outputDir;
  for (const project of root.projects) {
    if (options.signal?.aborted) break;
    options.write(`\n${c.bold(`▸ ${project.name}`)} ${c.gray(relative(root.rootDir, project.dir) || '.')}\n`);
    try {
      const result = await runProject({
        cwd: project.dir,
        ...(project.config !== undefined ? { config: project.config } : {}),
        overrides,
        write: options.write,
        reporters: [],
        ...(options.signal ? { signal: options.signal } : {}),
      });
      inputs.push({ report: result.report, dir: result.outputDir, label: project.name, project: project.name });
      codes.push(result.exitCode);
      failures.push(...result.failures.map((failure) => `${project.name}: ${failure}`));
    } catch (error) {
      if (!(error instanceof RunError)) throw error;
      codes.push(error.exitCode);
      failures.push(`${project.name}: ${error.message}`);
      options.write(`  ${c.red('✖')} ${error.message}\n`);
    }
  }
  if (inputs.length === 0) {
    throw new RunError(failures.join('\n') || 'No project could be tested.', worst(codes) === ExitCode.Ok ? ExitCode.Usage : worst(codes));
  }
  const report = mergeReports(inputs);
  copyScreenshots(inputs, root.outputDir);
  const exitCode = worst(codes);
  const { reporters } = createReporters(root.reporters);
  reporters.push(...options.reporters);
  const files: string[] = [];
  options.write(`\n${c.bold('All projects')} ${c.gray(`— ${inputs.map((input) => input.label).join(', ')}`)}\n`);
  const context = { config: root, baseUrl: report.run.baseUrl ?? '', totalPages: report.pages.length, write: options.write };
  for (const reporter of reporters) {
    const written = await reporter.onEnd?.(report, { ...context, exitCode, failures });
    if (written) files.push(...written);
  }
  return { report, exitCode, failures, files, notes, outputDir: root.outputDir };
}
