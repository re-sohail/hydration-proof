import type { ExitCode } from '../ci/exit-codes.ts';

export class RunError extends Error {
  override name = 'RunError';
  readonly exitCode: ExitCode;
  readonly details: string | undefined;

  constructor(message: string, exitCode: ExitCode, details?: string) {
    super(message);
    this.exitCode = exitCode;
    this.details = details;
  }
}
