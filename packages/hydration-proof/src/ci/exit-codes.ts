// Stable exit codes. Documented in docs/cli.md; never change a value.
export const ExitCode = {
  /** Every page passed the policy. */
  Ok: 0,
  /** Issues, budget or expired ignore rules failed the policy. */
  Failed: 1,
  /** Invalid configuration or command-line usage. */
  Usage: 2,
  /** The app could not be built, started or reached. */
  Server: 3,
  /** The browser is missing or failed to launch. */
  Browser: 4,
  /** A bug in hydration-proof. */
  Internal: 70,
  /** Interrupted (Ctrl+C). */
  Interrupted: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
