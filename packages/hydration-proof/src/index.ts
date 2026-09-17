// Public Node API of hydration-proof.

export { defineConfig } from './config/types.ts';
export type {
  BrowserConfig,
  BrowserName,
  BudgetConfig,
  BudgetLimits,
  BuildMode,
  CacheState,
  ChecksConfig,
  CiConfig,
  ColorScheme,
  CookieConfig,
  CrawlConfig,
  HookContext,
  HooksConfig,
  HydrationProofConfig,
  IgnoreConfig,
  IgnoreRule,
  InteractionConfig,
  InteractionContext,
  LoginContext,
  MatrixConfig,
  MockConfig,
  NavigationConfig,
  NetworkProfile,
  OwnersConfig,
  ProbeFactor,
  ProbesConfig,
  ProjectConfig,
  ReadyConfig,
  RedactConfig,
  ReporterName,
  RouteEntry,
  RoutesConfig,
  ScenarioConfig,
  ScenarioVariant,
  ServerConfig,
  ViewportOption,
} from './config/types.ts';
export { defineAdapter, definePlugin } from './plugins/index.ts';
export type {
  Adapter,
  AdapterCommands,
  AdapterContext,
  AdapterDefinition,
  AdapterNavigation,
  AdapterRoute,
  CauseDetector,
  DetectedCause,
  DetectorContext,
  DomElement,
  DomFragment,
  DomNode,
  HydrationProofPlugin,
  NormalizerRule,
  RouteProvider,
  RouteProviderContext,
} from './plugins/index.ts';
export { ADAPTERS } from './adapters/index.ts';
export { mergeReports, readReport } from './report/merge.ts';
export type { BaselineEntry, BaselineFile } from './ci/baseline.ts';
export { run, RunError } from './run.ts';
export type { RunOptions, RunResult } from './run.ts';
export type { CliOverrides } from './config/resolve.ts';
export { ExitCode } from './ci/exit-codes.ts';
export { ISSUES, docsUrl } from './issues/registry.ts';
export type { IssueCode, IssueDefinition, Severity } from './issues/registry.ts';
export { REPORT_SCHEMA_VERSION } from './report/model.ts';
export type {
  Cause,
  EnvironmentSplit,
  Evidence,
  HistoryEntry,
  Issue,
  PageResult,
  PageStatus,
  ProbeResult,
  ReactInfo,
  Report,
  RouteRef,
  RunInfo,
  SourceLocation,
  Stage,
  Summary,
  TimelineEntry,
} from './report/model.ts';
export type { Reporter, ReporterContext } from './report/reporters/index.ts';
export { configJsonSchema } from './config/schema.ts';
export { VERSION } from './util/version.ts';
