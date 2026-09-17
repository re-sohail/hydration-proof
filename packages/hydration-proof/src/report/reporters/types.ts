import type { ResolvedConfig } from '../../config/resolve.ts';
import type { Issue, PageResult, Report } from '../model.ts';

export interface ReporterContext {
  config: ResolvedConfig;
  baseUrl: string;
  totalPages: number;
  write(text: string): void;
}

export interface Reporter {
  name: string;
  onBegin?(context: ReporterContext): void | Promise<void>;
  onPage?(page: PageResult, issues: Issue[], context: ReporterContext): void | Promise<void>;
  /** Returns the files the reporter wrote. */
  onEnd?(report: Report, context: ReporterContext & { exitCode: number; failures: string[] }): void | string[] | Promise<void | string[]>;
}
