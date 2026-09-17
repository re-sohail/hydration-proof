import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter } from './types.ts';

export function jsonReporter(fileName = 'report.json'): Reporter {
  return {
    name: 'json',
    onEnd(report, context) {
      mkdirSync(context.config.outputDir, { recursive: true });
      const file = join(context.config.outputDir, fileName);
      writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
      return [file];
    },
  };
}
