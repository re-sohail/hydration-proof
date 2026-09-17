import { describe, expect, it } from 'vitest';
import { renderHtmlReport, scriptSafeJson } from '../../src/report/reporters/html.ts';
import type { Report } from '../../src/report/model.ts';

const report: Report = {
  schemaVersion: 1,
  tool: { name: 'hydration-proof', version: '0.0.0' },
  run: { startedAt: '', finishedAt: '', durationMs: 0, cwd: '/', node: 'v24', platform: 'x', playwright: '1', browsers: [], mode: 'production' },
  summary: { pages: 0, routes: 0, passed: 0, warnings: 0, failed: 1, errored: 0, issues: { error: 0, warning: 0, info: 0 }, ignored: 0 },
  pages: [],
  issues: [],
};

describe('HTML report', () => {
  it('embeds data that cannot close the script element', () => {
    const json = scriptSafeJson({ text: '</script><img src=x onerror=alert(1)>', sep: ' ' });
    expect(json).not.toContain('</script');
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual({ text: '</script><img src=x onerror=alert(1)>', sep: ' ' });
  });

  it('is a single self-contained document with a restrictive CSP', () => {
    const html = renderHtmlReport(report);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('id="hydration-proof-data"');
    expect(html).toContain('<title>Hydration Proof: 1 failed, 0 warnings, 0 passed</title>');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });
});
