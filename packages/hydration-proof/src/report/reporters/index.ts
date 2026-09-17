import type { ReporterName } from '../../config/types.ts';
import { htmlReporter } from './html.ts';
import { jsonReporter } from './json.ts';
import { listReporter } from './list.ts';
import type { Reporter } from './types.ts';

export function createReporters(names: readonly ReporterName[]): { reporters: Reporter[]; unsupported: ReporterName[] } {
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
      default:
        unsupported.push(name);
    }
  }
  return { reporters, unsupported };
}

export type { Reporter, ReporterContext } from './types.ts';
