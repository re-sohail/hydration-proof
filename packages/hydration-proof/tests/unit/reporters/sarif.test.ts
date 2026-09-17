import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { afterAll, describe, expect, it } from 'vitest';
import { docsUrl, ISSUES } from '../../../src/issues/registry.ts';
import type { Report } from '../../../src/report/model.ts';
import { jsonText } from '../../../src/report/reporters/ci-shared.ts';
import { renderSarif, sarifReporter, type SarifLog } from '../../../src/report/reporters/sarif.ts';
import { anonymize, expectGolden, issue, makeConfig, makeContext, makeReport, makeWorkspace, page } from './fixture.ts';

const workspace = makeWorkspace();
const bare = makeWorkspace({ git: false });
afterAll(() => {
  workspace.cleanup();
  bare.cleanup();
});

// The official OASIS schema is draft-04. The only draft-04 keyword it uses is the
// root `id` (every other keyword means the same in draft-07), so rename it and
// validate with Ajv's default draft-07 validator. See __golden__/README.md.
const { $schema: draft04, id, ...definition } = JSON.parse(
  readFileSync(new URL('./__golden__/sarif-2.1.0.schema.json', import.meta.url), 'utf8'),
);
expect(draft04).toBe('http://json-schema.org/draft-04/schema#');
const schema = { $schema: 'http://json-schema.org/draft-07/schema#', $id: id, ...definition };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('uri', /^[a-z][a-z0-9+.-]*:\S*$/i);
ajv.addFormat('uri-reference', /^\S*$/);
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i);
const validate = ajv.compile(schema);

function expectValid(log: unknown): void {
  const valid = validate(log);
  expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
}

function render(report: Report = makeReport(), exitCode = 1, config = makeConfig(workspace)): SarifLog {
  return renderSarif(report, { config, exitCode });
}

describe('SARIF reporter', () => {
  it('matches the golden file', () => {
    // Only the rules the results use, and rule ids instead of indexes, so adding
    // an issue code does not change the file (both are checked below).
    const log = render();
    const run = log.runs[0]!;
    const used = new Set(run.results.map((result) => result.ruleId));
    const normalized = {
      ...log,
      runs: [
        {
          ...run,
          tool: { driver: { ...run.tool.driver, rules: run.tool.driver.rules.filter((rule) => used.has(rule.id)) } },
          results: run.results.map((result) => ({ ...result, ruleIndex: `index of ${result.ruleId}` })),
        },
      ],
    };
    expectGolden('report.sarif', anonymize(jsonText(normalized), workspace));
  });

  it('is valid against the official SARIF 2.1.0 schema', () => {
    expectValid(render());
    expectValid(render({ ...makeReport(), pages: [], issues: [] }, 0));
    expectValid(render(makeReport(), 1, makeConfig({ ...bare, configFile: undefined })));
  });

  it('checks the schema really rejects broken logs', () => {
    const log = render() as unknown as { runs: { results: { level: string }[] }[] };
    log.runs[0]!.results[0]!.level = 'fatal';
    expect(validate(log)).toBe(false);
  });

  it('lists every issue code as a rule', () => {
    const { rules } = render().runs[0]!.tool.driver;
    expect(rules.map((rule) => rule.id)).toEqual([...ISSUES.keys()]);
    const text = rules.find((rule) => rule.id === 'HP1001')!;
    expect(text).toMatchObject({
      name: 'TextMismatch',
      shortDescription: { text: 'Text differs between server and client' },
      helpUri: docsUrl('HP1001'),
      defaultConfiguration: { level: 'error' },
      properties: { tags: ['hydration', 'react', 'dom-mismatch'] },
    });
    expect(rules.find((rule) => rule.id === 'HP3003')!.defaultConfiguration.level).toBe('note');
    expect(rules.find((rule) => rule.id === 'HP9010')!.defaultConfiguration.level).toBe('warning');
    // "<head>" in a description must not become HTML in the help Markdown.
    expect(rules.find((rule) => rule.id === 'HP1014')!.help.markdown).toContain('&lt;head&gt;');
  });

  it('points results at their rules and keeps fingerprints', () => {
    const run = render().runs[0]!;
    expect(run.results).toHaveLength(makeReport().issues.length);
    for (const result of run.results) {
      expect(run.tool.driver.rules[result.ruleIndex!]!.id).toBe(result.ruleId);
      expect(result.partialFingerprints!['hydrationProof/v1']).toMatch(/^[a-z0-9]+$/);
      expect(result.locations[0]!.logicalLocations[0]!.name).toMatch(/^\//);
    }
    expect(run.results.map((result) => result.level)).toEqual(['error', 'error', 'error', 'error', 'error', 'error', 'warning', 'warning', 'note', 'error']);
  });

  it('uses repository-relative locations with a fallback', () => {
    const run = render().runs[0]!;
    expect(run.originalUriBaseIds['%SRCROOT%']!.uri).toBe(`${pathToFileURL(workspace.repo).href}/`);
    const locations = run.results.map((result) => result.locations[0]!.physicalLocation);
    for (const location of locations) {
      expect(location.artifactLocation.uriBaseId).toBe('%SRCROOT%');
      expect(location.artifactLocation.uri).not.toMatch(/^(\/|\.\.|[a-z]+:)/i);
    }
    const byCode = new Map(run.results.map((result, index) => [result.ruleId, locations[index]!]));
    expect(byCode.get('HP1001')).toEqual({
      artifactLocation: { uri: 'apps/web/src/app/products/[id]/page.tsx', uriBaseId: '%SRCROOT%' },
      region: { startLine: 12, startColumn: 7 },
    });
    // A source outside the app but inside the repository.
    expect(byCode.get('HP1004')).toEqual({
      artifactLocation: { uri: 'packages/ui/src/Button.tsx', uriBaseId: '%SRCROOT%' },
      region: { startLine: 3 },
    });
    // No source: the config file.
    expect(byCode.get('HP1005')).toEqual({
      artifactLocation: { uri: 'apps/web/hydration-proof.config.ts', uriBaseId: '%SRCROOT%' },
      region: { startLine: 1 },
    });
    const message = run.results.find((result) => result.ruleId === 'HP1005')!.message.text;
    expect(message).toContain('No source location: The scripts have no source maps. This result is attached to apps/web/hydration-proof.config.ts.');
  });

  it('falls back to package.json and the app directory without a config file or git repository', () => {
    const run = render(makeReport(), 1, makeConfig({ ...bare, configFile: undefined })).runs[0]!;
    expect(run.originalUriBaseIds['%SRCROOT%']!.uri).toBe(`${pathToFileURL(bare.app).href}/`);
    const result = run.results.find((entry) => entry.ruleId === 'HP1005')!;
    expect(result.locations[0]!.physicalLocation.artifactLocation.uri).toBe('package.json');
    // Outside the (app-rooted) base: fall back too, and say where the source is.
    const outside = run.results.find((entry) => entry.ruleId === 'HP1004')!;
    expect(outside.locations[0]!.physicalLocation.artifactLocation.uri).toBe('package.json');
    expect(outside.message.text).toContain('The source (../../packages/ui/src/Button.tsx:3) is outside the repository.');
  });

  it('suppresses ignored issues instead of dropping them', () => {
    const results = render().runs[0]!.results;
    const ignored = results.filter((result) => result.suppressions);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]!.ruleId).toBe('HP1002');
    expect(ignored[0]!.suppressions).toEqual([
      { kind: 'external', status: 'accepted', justification: 'Known analytics attribute (code HP1002 on /nasty)' },
    ]);
    expect(results.at(-1)).toBe(ignored[0]);
  });

  it('describes the invocation', () => {
    const [invocation] = render().runs[0]!.invocations;
    expect(invocation).toEqual({
      executionSuccessful: true,
      exitCode: 1,
      startTimeUtc: '2026-09-17T10:00:00.000Z',
      endTimeUtc: '2026-09-17T10:00:12.345Z',
      workingDirectory: { uri: `${pathToFileURL(workspace.app).href}/` },
    });
    for (const code of [2, 3, 4, 70]) expect(render(makeReport(), code).runs[0]!.invocations[0]!.executionSuccessful).toBe(false);
    expect(render(makeReport(), 0).runs[0]!.invocations[0]!.executionSuccessful).toBe(true);
  });

  it('survives incomplete data', () => {
    const odd = {
      schemaVersion: 1,
      tool: {},
      run: { startedAt: 'not a date' },
      pages: [null, { status: 'failed' }],
      issues: [
        null,
        { code: 'HP0000' },
        { ...issue('HP1001', { url: '/x', scenario: 'default' }), fingerprint: '', source: { file: 'webpack://app/x.js', line: 0 } },
      ],
    } as unknown as Report;
    const log = render(odd);
    expectValid(log);
    const { results } = log.runs[0]!;
    expect(results).toHaveLength(2);
    const unknown = results.find((result) => result.ruleId === 'HP0000');
    const known = results.find((result) => result.ruleId === 'HP1001');
    expect(unknown!.ruleIndex).toBeUndefined();
    expect(known!.partialFingerprints).toBeUndefined();
    expect(known!.locations[0]!.physicalLocation.artifactLocation.uri).toBe('apps/web/hydration-proof.config.ts');
    expect(() => renderSarif({} as Report, { config: undefined, exitCode: 1 })).not.toThrow();
  });

  it('writes report.sarif into the output directory', async () => {
    const report: Report = { ...makeReport(), pages: [page('/', 'default', [])], issues: [] };
    const files = await sarifReporter().onEnd!(report, makeContext(makeConfig(workspace)));
    const file = join(workspace.outputDir, 'report.sarif');
    expect(files).toEqual([file]);
    expect(existsSync(file)).toBe(true);
    expectValid(JSON.parse(readFileSync(file, 'utf8')));

    // Invisible characters are escaped, and the file still parses to the same log.
    await sarifReporter().onEnd!(makeReport(), makeContext(makeConfig(workspace)));
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('\\u007f\\u0085\\u009f');
    expect([...text].some((char) => char.charCodeAt(0) < 0x20 && !'\t\n\r'.includes(char))).toBe(false);
    expect(JSON.parse(text)).toEqual(render());
  });
});
