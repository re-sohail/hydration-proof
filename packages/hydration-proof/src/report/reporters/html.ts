import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import client from 'virtual:hydration-proof/report-client';
import type { Report } from '../model.ts';
import type { Reporter } from './types.ts';

/** JSON that can sit inside a <script> element without ending it. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderHtmlReport(report: Report): string {
  const s = report.summary;
  const title = `Hydration Proof: ${s.failed + s.errored} failed, ${s.warnings} warnings, ${s.passed} passed`;
  const icon = s.failed + s.errored > 0 ? '%E2%9C%96' : '%E2%9C%93';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><text y=%2213%22 font-size=%2214%22>${icon}</text></svg>">
</head>
<body>
<div id="app"><noscript>This report needs JavaScript. The same data is in report.json.</noscript></div>
<script type="application/json" id="hydration-proof-data">${scriptSafeJson(report)}</script>
<script>${client.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

export function htmlReporter(fileName = 'report.html'): Reporter {
  return {
    name: 'html',
    onEnd(report, context) {
      mkdirSync(context.config.outputDir, { recursive: true });
      const file = join(context.config.outputDir, fileName);
      writeFileSync(file, renderHtmlReport(report));
      return [file];
    },
  };
}
