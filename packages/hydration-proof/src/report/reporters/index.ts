import type { ReporterName } from '../../config/types.ts';
import { gitlabReporter } from './gitlab.ts';
import { githubReporter } from './github.ts';
import { htmlReporter } from './html.ts';
import { jsonReporter } from './json.ts';
import { junitReporter } from './junit.ts';
import { listReporter } from './list.ts';
import { sarifReporter } from './sarif.ts';
import type { Reporter } from './types.ts';

export function createReporters(
  names: readonly ReporterName[],
  env: NodeJS.ProcessEnv = process.env,
): { reporters: Reporter[]; unsupported: ReporterName[] } {
  const reporters: Reporter[] = [];
  const unsupported: ReporterName[] = [];
  for (const name of new Set(names)) {
    switch (name) {
      case 'list':
        reporters.push(listReporter());
        break;
      case 'json':
        reporters.push(jsonReporter());
        break;
      case 'html':
        reporters.push(htmlReporter());
        break;
      case 'junit':
        reporters.push(junitReporter());
        break;
      case 'sarif':
        reporters.push(sarifReporter());
        break;
      case 'github':
        reporters.push(githubReporter(env));
        break;
      case 'gitlab':
        reporters.push(gitlabReporter(env));
        break;
      default:
        unsupported.push(name);
    }
  }
  return { reporters, unsupported };
}

export { detectGithubActions } from './github.ts';
export type { Reporter, ReporterContext } from './types.ts';
