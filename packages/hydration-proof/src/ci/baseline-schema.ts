import { s, toJsonSchema, type JsonSchema, type Schema } from '../config/schema-dsl.ts';
import { BASELINE_VERSION } from './baseline.ts';

// JSON Schema of the baseline file, so editors can check hand-written reasons
// and expiry dates.

const date = s.string({ description: 'Date (YYYY-MM-DD).' });

const entry: Schema = s.object(
  {
    fingerprint: s.string({ description: 'Stable issue fingerprint.' }),
    code: s.string(),
    title: s.string(),
    route: s.string({ description: 'Route pattern.' }),
    selector: s.string(),
    attribute: s.string(),
    cause: s.string({ description: 'Likely cause when the entry was recorded.' }),
    scenarios: s.array(s.string()),
    firstSeen: date,
    lastSeen: date,
    expires: s.string({ description: 'After this date (YYYY-MM-DD) the entry no longer excuses the finding and the run fails.' }),
    reason: s.string({ description: 'Why this finding is accepted for now.' }),
  },
  'An accepted finding.',
  ['fingerprint', 'code', 'title', 'route', 'scenarios', 'firstSeen', 'lastSeen'],
);

export const baselineSchema: Schema = s.object(
  {
    $schema: s.string(),
    version: s.literal(BASELINE_VERSION),
    tool: s.literal('hydration-proof'),
    updatedAt: s.string(),
    entries: s.array(entry),
  },
  'hydration-proof baseline',
  ['version', 'tool', 'updatedAt', 'entries'],
);

export function baselineJsonSchema(): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hydration.jscrate.dev/schema/baseline.json',
    title: 'hydration-proof baseline',
    ...toJsonSchema(baselineSchema),
  };
}
