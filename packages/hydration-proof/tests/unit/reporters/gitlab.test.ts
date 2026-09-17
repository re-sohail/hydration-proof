import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Issue, Report } from '../../../src/report/model.ts';
import { jsonText } from '../../../src/report/reporters/ci-shared.ts';
import { codeQualitySeverity, gitlabReporter, renderCodeQuality } from '../../../src/report/reporters/gitlab.ts';
import { expectGolden, issue, makeConfig, makeContext, makeReport, makeWorkspace, page } from './fixture.ts';

const workspace = makeWorkspace();
afterAll(() => workspace.cleanup());
const config = makeConfig(workspace);

describe('GitLab Code Quality reporter', () => {
  it('matches the golden file', () => {
    expectGolden('gl-code-quality.json', jsonText(renderCodeQuality(makeReport(), config, {})));
  });

  it('has the fields GitLab requires, for non-ignored issues only', () => {
    const entries = renderCodeQuality(makeReport(), config, {});
    expect(entries).toHaveLength(makeReport().issues.filter((entry) => !entry.ignored).length);
    expect(entries.map((entry) => entry.check_name)).not.toContain('HP1002');
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['check_name', 'description', 'fingerprint', 'location', 'severity']);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.description).not.toMatch(/\n/);
      expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(['info', 'minor', 'major', 'critical', 'blocker']).toContain(entry.severity);
      expect(entry.location.path).not.toMatch(/^(\/|\.\.)/);
      expect(Number.isInteger(entry.location.lines.begin) && entry.location.lines.begin >= 1).toBe(true);
    }
  });

  it('maps severities with a documented rule', () => {
    expect(codeQualitySeverity({ severity: 'error', confidence: 0.95 })).toBe('critical');
    expect(codeQualitySeverity({ severity: 'error', confidence: 0.9 })).toBe('critical');
    expect(codeQualitySeverity({ severity: 'error', confidence: 0.89 })).toBe('major');
    expect(codeQualitySeverity({ severity: 'error', confidence: Number.NaN })).toBe('major');
    expect(codeQualitySeverity({ severity: 'warning', confidence: 1 })).toBe('minor');
    expect(codeQualitySeverity({ severity: 'info', confidence: 1 })).toBe('info');
  });

  it('uses repository-relative paths, CI_PROJECT_DIR and the config file fallback', () => {
    const byCode = (entries: ReturnType<typeof renderCodeQuality>, code: string) => entries.find((entry) => entry.check_name === code)!;
    const entries = renderCodeQuality(makeReport(), config, {});
    expect(byCode(entries, 'HP1001').location).toEqual({ path: 'apps/web/src/app/products/[id]/page.tsx', lines: { begin: 12 } });
    expect(byCode(entries, 'HP1004').location).toEqual({ path: 'packages/ui/src/Button.tsx', lines: { begin: 3 } });
    expect(byCode(entries, 'HP1005').location).toEqual({ path: 'apps/web/hydration-proof.config.ts', lines: { begin: 1 } });

    // GitLab's project directory wins over the .git lookup.
    const project = renderCodeQuality(makeReport(), config, { CI_PROJECT_DIR: workspace.app });
    expect(byCode(project, 'HP1001').location.path).toBe('src/app/products/[id]/page.tsx');
    // Outside the project directory: fall back, and keep the source in the description.
    expect(byCode(project, 'HP1004').location).toEqual({ path: 'hydration-proof.config.ts', lines: { begin: 1 } });
    expect(byCode(project, 'HP1004').description).toContain('source: ../../packages/ui/src/Button.tsx:3');

    const noConfig = renderCodeQuality(makeReport(), makeConfig({ ...workspace, configFile: undefined }), {});
    expect(byCode(noConfig, 'HP1005').location.path).toBe('apps/web/package.json');
  });

  it('describes issues on one line', () => {
    const entries = renderCodeQuality(makeReport(), config, {});
    expect(entries.find((entry) => entry.check_name === 'HP1001')!.description).toBe(
      'HP1001 Text differs between server and client on /products/1?ref=a,b (scenario guest, production build): #price; server "Price: 10%\\nnow", client "Price: 12%\\r\\nlater"; likely cause: Time-dependent value (97% confidence)',
    );
    const long = entries.find((entry) => entry.check_name === 'HP1013')!.description;
    expect(long.length).toBeLessThanOrEqual(1000);
  });

  it('gives every entry a unique fingerprint that is stable across runs', () => {
    const duplicate = (url: string): Issue => issue('HP1001', { url, scenario: 'default', fingerprint: 'same' });
    const issues = [duplicate('/a'), duplicate('/a'), duplicate('/a'), duplicate('/b'), { ...duplicate('/a'), mode: 'development' as const }];
    const report: Report = { ...makeReport(), pages: [page('/a', 'default', issues)], issues };
    const first = renderCodeQuality(report, config, {}).map((entry) => entry.fingerprint);
    expect(new Set(first).size).toBe(issues.length);

    // Another port (every run starts the app on a new one) does not change them.
    const moved = issues.map((entry) => ({ ...entry, route: { ...entry.route, url: entry.route.url.replace('4173', '5000') } }));
    const second = renderCodeQuality({ ...report, issues: moved }, config, {}).map((entry) => entry.fingerprint);
    expect(second).toEqual(first);

    const all = renderCodeQuality(makeReport(), config, {}).map((entry) => entry.fingerprint);
    expect(new Set(all).size).toBe(all.length);
  });

  it('survives incomplete data', () => {
    const odd = { issues: [null, {}, { code: 'HP1001', severity: 'error', source: { file: 42 } }] } as unknown as Report;
    const entries = renderCodeQuality(odd, undefined, {});
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(entry.location.lines.begin).toBe(1);
    expect(renderCodeQuality({} as Report, config, {})).toEqual([]);
  });

  it('writes gl-code-quality.json into the output directory', async () => {
    const files = await gitlabReporter({}).onEnd!(makeReport(), makeContext(config));
    const file = join(workspace.outputDir, 'gl-code-quality.json');
    expect(files).toEqual([file]);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(renderCodeQuality(makeReport(), config, {}));
  });
});
