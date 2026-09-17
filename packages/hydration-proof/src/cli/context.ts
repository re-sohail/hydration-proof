export interface CommandContext {
  cwd: string;
  out(text: string): void;
  err(text: string): void;
  signal: AbortSignal;
  env: NodeJS.ProcessEnv;
}

export class UsageError extends Error {
  override name = 'UsageError';
}
