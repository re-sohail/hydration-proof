import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { selfCommand, type PackageManager } from '../util/package-manager.ts';

// CI workflows written by `hydration-proof init --ci github|gitlab`.

export type CiProvider = 'github' | 'gitlab';

export function installCommand(manager: PackageManager, rootDir: string): string {
  switch (manager) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'yarn':
      return existsSync(join(rootDir, '.yarnrc.yml')) ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
    case 'bun':
      return 'bun install --frozen-lockfile';
    default:
      return 'npm ci';
  }
}

export function githubWorkflow(manager: PackageManager, rootDir: string): string {
  const self = (args: string): string => selfCommand(manager, args);
  const setup: string[] = [];
  if (manager === 'pnpm') setup.push('      - uses: pnpm/action-setup@v4');
  if (manager === 'bun') setup.push('      - uses: oven-sh/setup-bun@v2');
  const cache = manager === 'bun' ? '' : `\n          cache: ${manager}`;
  return `# Finds React hydration problems on every pull request.
# Docs: https://hydration.jscrate.dev/docs/ci
name: Hydration

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  # Upload findings to code scanning (SARIF).
  security-events: write

jobs:
  hydration:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          # Lets "--changed" compare with the base branch.
          fetch-depth: 0
${setup.length > 0 ? `${setup.join('\n')}\n` : ''}      - uses: actions/setup-node@v4
        with:
          node-version: 24${cache}
      - run: ${installCommand(manager, rootDir)}
      - run: ${self('install --with-deps chromium')}
      # Annotations and the job summary are added automatically on GitHub Actions.
      # For large apps, add "--changed" on pull requests, or split with "--shard 1/3".
      - run: ${self('test --reporter list,html,json,github,sarif')}
      - uses: github/codeql-action/upload-sarif@v3
        if: always() && hashFiles('.hydration-proof/report/report.sarif') != ''
        with:
          sarif_file: .hydration-proof/report/report.sarif
          category: hydration-proof
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: hydration-report
          path: .hydration-proof/report
          retention-days: 14
`;
}

export function gitlabJob(manager: PackageManager, rootDir: string): string {
  const self = (args: string): string => selfCommand(manager, args);
  const before = manager === 'pnpm' || manager === 'yarn' ? '    - corepack enable\n' : manager === 'bun' ? '    - npm install -g bun\n' : '';
  return `# Finds React hydration problems. Include it from .gitlab-ci.yml:
#   include:
#     - local: .gitlab/hydration-proof.yml
# Docs: https://hydration.jscrate.dev/docs/ci
hydration:
  image: node:24
  stage: test
  variables:
    GIT_DEPTH: 0
  script:
${before}    - ${installCommand(manager, rootDir)}
    - ${self('install --with-deps chromium')}
    - ${self('test --reporter list,html,json,junit,gitlab')}
  artifacts:
    when: always
    expire_in: 14 days
    paths:
      - .hydration-proof/report
    reports:
      junit: .hydration-proof/report/junit.xml
      codequality: .hydration-proof/report/gl-code-quality.json
`;
}

export function ciFile(provider: CiProvider): string {
  return provider === 'github' ? join('.github', 'workflows', 'hydration.yml') : join('.gitlab', 'hydration-proof.yml');
}
