import { existsSync, readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { reportJsonSchema } from '../../src/report/schema.ts';

const fixtureReports = ['next-app', 'next-pages']
  .map((app) => new URL(`../../../../fixtures/${app}/.hydration-proof/report/report.json`, import.meta.url).pathname)
  .filter((file) => existsSync(file));

describe('report schema', () => {
  const validate = new Ajv({ strict: false }).compile(reportJsonSchema());

  it('matches the generated schema file', () => {
    const file = new URL('../../schema/report.json', import.meta.url);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(reportJsonSchema());
  });

  it.skipIf(fixtureReports.length === 0).each(fixtureReports)('validates %s', (file) => {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    expect(validate(report), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('rejects unknown issue codes', () => {
    expect(
      validate({ schemaVersion: 1, tool: { name: 'hydration-proof', version: '1' }, run: {}, summary: {}, pages: [], issues: [{ code: 'X' }] }),
    ).toBe(false);
  });
});
