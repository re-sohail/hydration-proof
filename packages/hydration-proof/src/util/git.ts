import { execFileSync } from 'node:child_process';

// Small, dependency-free git helpers. Every function returns undefined when
// git or the repository is not available.

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
  } catch {
    return undefined;
  }
}

export function gitRoot(cwd: string): string | undefined {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

export function currentCommit(cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['GITHUB_SHA'] ?? env['CI_COMMIT_SHA'] ?? env['CIRCLE_SHA1'] ?? git(cwd, ['rev-parse', 'HEAD']);
}

export function currentBranch(cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromCi = env['GITHUB_HEAD_REF'] || env['GITHUB_REF_NAME'] || env['CI_COMMIT_REF_NAME'] || env['CIRCLE_BRANCH'];
  if (fromCi) return fromCi;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch === 'HEAD' ? undefined : branch;
}

/** The ref to compare with when `--changed` has no value: the pull request base, or the default branch. */
export function defaultBaseRef(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env['GITHUB_BASE_REF']) return `origin/${env['GITHUB_BASE_REF']}`;
  if (env['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']) return `origin/${env['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']}`;
  const remoteHead = git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead) return remoteHead;
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git(cwd, ['rev-parse', '--verify', '--quiet', candidate]) !== undefined) return candidate;
  }
  return 'HEAD~1';
}

/**
 * Files changed since `ref` (committed on this branch, staged, unstaged and
 * untracked), as paths relative to the repository root. Undefined when the
 * ref cannot be resolved.
 */
export function changedFiles(cwd: string, ref: string): string[] | undefined {
  if (git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === undefined) return undefined;
  const base = git(cwd, ['merge-base', ref, 'HEAD']) ?? ref;
  const committed = git(cwd, ['diff', '--name-only', '--no-renames', `${base}...HEAD`]) ?? '';
  const working = git(cwd, ['diff', '--name-only', '--no-renames', 'HEAD']) ?? '';
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']) ?? '';
  const files = new Set<string>();
  for (const block of [committed, working, untracked]) {
    for (const line of block.split('\n')) if (line.trim()) files.add(line.trim());
  }
  return [...files].sort();
}
