// Public Node API of hydration-proof.

export { defineConfig } from './config/types.ts';
export type {
  BrowserConfig,
  BrowserName,
  BuildMode,
  ChecksConfig,
  CiConfig,
  ColorScheme,
  CookieConfig,
  HydrationProofConfig,
  IgnoreConfig,
  IgnoreRule,
  ReadyConfig,
  ReporterName,
  RouteEntry,
  RoutesConfig,
  ScenarioConfig,
  ServerConfig,
} from './config/types.ts';
export { run, RunError } from './run.ts';
export type { RunOptions, RunResult } from './run.ts';
export type { CliOverrides } from './config/resolve.ts';
export { ExitCode } from './ci/exit-codes.ts';
export { ISSUES, docsUrl } from './issues/registry.ts';
export type { IssueCode, IssueDefinition, Severity } from './issues/registry.ts';
export { REPORT_SCHEMA_VERSION } from './report/model.ts';
export type {
  Cause,
  Evidence,
  Issue,
  PageResult,
  PageStatus,
  ReactInfo,
  Report,
  RouteRef,
  RunInfo,
  SourceLocation,
  Stage,
  Summary,
} from './report/model.ts';
export type { Reporter, ReporterContext } from './report/reporters/index.ts';
export { configJsonSchema } from './config/schema.ts';
export { VERSION } from './util/version.ts';
