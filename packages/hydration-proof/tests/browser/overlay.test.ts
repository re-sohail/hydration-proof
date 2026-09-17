import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import overlaySource from 'virtual:hydration-proof/overlay';
import { describe, expect, it } from 'vitest';
import { devSession } from '../../src/dev/session.ts';
import { OVERLAY_BINDING, OVERLAY_GLOBAL, type OverlayAction, type OverlayState } from '../../src/shared/overlay.ts';
import { harnessUrl, useBrowser } from '../helpers/browser.ts';

// The development overlay and `hydration-proof dev` (headless).

describe('overlay', () => {
  const browser = useBrowser();

  it('shows findings and sends actions', async () => {
    const context = await browser().newContext();
    const actions: OverlayAction[] = [];
    await context.exposeBinding(OVERLAY_BINDING, (_source, action: OverlayAction) => {
      actions.push(action);
    });
    await context.addInitScript({ content: overlaySource });
    try {
      const page = await context.newPage();
      await page.goto(harnessUrl('19', 'production', 'text-mismatch'));
      const overlay = page.locator('hydration-proof-overlay');
      await expect.poll(() => overlay.count()).toBe(1);
      expect(await overlay.getAttribute('data-hydration-proof-internal')).toBe('');
      await expect.poll(() => overlay.locator('button.badge').textContent()).toContain('checking');

      const state: OverlayState = {
        status: 'done',
        url: page.url(),
        outcome: 'hydrated',
        react: 'React 19.3.0 (production)',
        issues: [
          {
            fingerprint: 'f1',
            code: 'HP1001',
            title: 'Text differs between server and client',
            severity: 'error',
            message: 'm',
            selector: '#env',
            server: 'server',
            client: 'client',
            cause: { title: 'Time-dependent value', confidence: 0.99, proven: true },
            source: { file: 'src/Env.tsx', line: 4, column: 7, absolute: '/app/src/Env.tsx' },
            suggestions: ['Render the same text.'],
            docsUrl: 'https://hydration.jscrate.dev/docs/issues/hp1001',
          },
        ],
      };
      await page.evaluate(([key, value]) => (globalThis as unknown as Record<string, { show(state: unknown): void }>)[key]!.show(value), [OVERLAY_GLOBAL, state] as const);
      const badge = overlay.locator('button.badge');
      await expect.poll(() => badge.textContent()).toBe('Hydration: 1 error');
      // Errors open the panel.
      const panel = overlay.locator('.panel');
      expect(await panel.textContent()).toContain('Time-dependent value (proven)');
      expect(await panel.textContent()).toContain('"server"');

      await panel.getByText('Highlight').click();
      await expect.poll(() => page.locator('div[data-hydration-proof-internal]').count()).toBe(1);
      await panel.getByText('Open Env.tsx:4').click();
      await panel.getByText('Copy report').click();
      await panel.getByText('Re-run').click();
      await expect.poll(() => actions.length).toBeGreaterThanOrEqual(3);
      expect(actions.slice(0, 3)).toEqual([
        { type: 'open', file: '/app/src/Env.tsx', line: 4, column: 7 },
        { type: 'copied', count: 1 },
        { type: 'rerun' },
      ]);

      await page.evaluate(([key]) => (globalThis as unknown as Record<string, { show(state: unknown): void }>)[key]!.show({ status: 'done', url: '', issues: [] }), [OVERLAY_GLOBAL] as const);
      await expect.poll(() => badge.textContent()).toBe('Hydration: no problems');
    } finally {
      await context.close();
    }
  });
});

describe('hydration-proof dev', () => {
  it('checks every page that is opened and reports in the terminal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hp-dev-'));
    writeFileSync(join(root, 'hydration-proof.config.mjs'), 'export default { adapter: "none" };\n');
    const url = harnessUrl('19', 'development', 'text-mismatch');
    const base = new URL(url).origin;
    const controller = new AbortController();
    let output = '';
    process.env['HYDRATION_PROOF_DEV_HEADLESS'] = '1';
    try {
      const session = devSession({
        cwd: root,
        overrides: { url: base, routes: ['/text-mismatch'] },
        write: (text) => {
          output += text;
        },
        signal: controller.signal,
      });
      await expect.poll(() => output, { timeout: 30_000 }).toMatch(/\/text-mismatch .*1 error/);
      controller.abort();
      await expect(session).resolves.toBe(0);
      expect(output).toContain('HP1001');
      expect(output).toContain('Hydration Proof dev');
    } finally {
      delete process.env['HYDRATION_PROOF_DEV_HEADLESS'];
      controller.abort();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
