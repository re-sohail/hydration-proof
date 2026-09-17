import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, planMigrations } from '../../../src/config/migrate.ts';
import { main } from '../../../src/cli/main.ts';

describe('planMigrations', () => {
  it('finds every renamed and replaced option', () => {
    const changes = planMigrations({
      normalize: { ignoreSelectors: ['#ad'], ignoreAttributes: ['data-x'], maskText: [/secret/] },
      server: { start: 'pnpm start' },
      checks: { suppressedWarnings: 'warn' },
      reporters: ['console', 'json'],
      ignore: { issues: [{ code: 'HP1001', until: '2026-01-01' }] },
      interactions: false,
      ci: { maxWarnings: 3 },
    });
    expect(changes.map((change) => [change.from, change.to])).toEqual([
      ['normalize.ignoreSelectors', 'ignore.selectors'],
      ['normalize.ignoreAttributes', 'ignore.attributes'],
      ['normalize.maskText', 'redact.patterns'],
      ['normalize', 'ignore'],
      ['server.start', 'server.command'],
      ["checks.suppressedWarnings: 'warn'", "checks.suppressedWarnings: 'info'"],
      ["reporters: 'console'", "reporters: 'list'"],
      ['ignore.issues[].until', 'ignore.issues[].expires'],
      ['interactions: boolean', 'checks.interactions'],
      ['ci.maxWarnings', 'ci.budget.warning'],
    ]);
  });

  it('reports nothing for a current config', () => {
    expect(
      planMigrations({
        routes: { paths: ['/'] },
        server: { command: 'pnpm start', url: 'http://localhost:3000' },
        ignore: { selectors: ['#ad'], issues: [{ code: 'HP1001', reason: 'known', expires: '2027-01-01' }] },
        checks: { suppressedWarnings: 'info', interactions: true },
        reporters: ['list'],
        redact: { patterns: [/secret/] },
      }),
    ).toEqual([]);
  });

  it('ignores anything that is not an object', () => {
    expect(planMigrations(undefined)).toEqual([]);
    expect(planMigrations('config')).toEqual([]);
    expect(planMigrations([{ normalize: {} }])).toEqual([]);
  });
});

describe('applyMigrations', () => {
  it('renames unique keys and leaves the rest for the reader', () => {
    const text = [
      'export default {',
      "  server: { start: 'pnpm start' },",
      '  normalize: {',
      "    ignoreSelectors: ['#ad'],",
      '    maskText: [/secret/],',
      '  },',
      '};',
    ].join('\n');
    const result = applyMigrations(text, planMigrations({ server: { start: 'x' }, normalize: { ignoreSelectors: [], maskText: [] } }));
    expect(result.text).toContain("server: { command: 'pnpm start' }");
    expect(result.text).toContain("selectors: ['#ad']");
    expect(result.text).toContain('  ignore: {');
    expect(result.applied.map((change) => change.from)).toEqual(['normalize.ignoreSelectors', 'normalize', 'server.start']);
    // Masking has no automatic equivalent.
    expect(result.manual.map((change) => change.from)).toEqual(['normalize.maskText']);
    expect(result.text).toContain('maskText');
  });

  it('rewrites quoted values', () => {
    const result = applyMigrations("export default { reporters: ['console', 'json'] };", planMigrations({ reporters: ['console'] }));
    expect(result.text).toBe("export default { reporters: ['list', 'json'] };");
    expect(result.applied).toHaveLength(1);
  });

  it('keeps double quotes when the file uses them', () => {
    const result = applyMigrations('{ "reporters": ["console"] }', planMigrations({ reporters: ['console'] }));
    expect(result.text).toBe('{ "reporters": ["list"] }');
  });

  it('refuses a rename when the key is not unique', () => {
    const text = "export default { server: { start: 'a' }, projects: [{ server: { start: 'b' } }] };";
    const result = applyMigrations(text, planMigrations({ server: { start: 'a' } }));
    expect(result.text).toBe(text);
    expect(result.applied).toEqual([]);
    expect(result.manual.map((change) => change.from)).toEqual(['server.start']);
  });

  it('does not touch a key that only appears inside a value', () => {
    const text = "export default { normalize: { ignoreSelectors: ['[data-start]'] } };";
    const result = applyMigrations(text, planMigrations({ normalize: { ignoreSelectors: [] } }));
    expect(result.text).toContain("['[data-start]']");
    expect(result.text).toContain('selectors:');
  });
});

describe('migrate command', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const capture = () => {
    let out = '';
    let err = '';
    return {
      io: { out: (text: string) => void (out += text), err: (text: string) => void (err += text) },
      get out() {
        return out;
      },
      get err() {
        return err;
      },
    };
  };

  it('lists the changes, then applies them with --write', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-migrate-'));
    const file = join(dir, 'hydration-proof.config.mjs');
    const original = ["export default {", "  routes: { paths: ['/'] },", "  server: { start: 'pnpm start', url: 'http://localhost:3000' },", '};', ''].join('\n');
    writeFileSync(file, original);
    const io = capture();

    expect(await main(['migrate'], { ...io.io, cwd: dir })).toBe(0);
    expect(io.out).toContain('1 change for hydration-proof.config.mjs');
    expect(io.out).toContain('server.start');
    expect(io.out).toContain('server.command');
    expect(readFileSync(file, 'utf8')).toBe(original);

    const write = capture();
    expect(await main(['migrate', '--write'], { ...write.io, cwd: dir })).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain("command: 'pnpm start'");
    expect(readFileSync(`${file}.backup`, 'utf8')).toBe(original);
    expect(write.out).toContain('Updated');
  });

  it('says a current config needs no changes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-migrate-'));
    const file = join(dir, 'hydration-proof.config.mjs');
    writeFileSync(file, "export default { routes: { paths: ['/'] }, server: { url: 'http://localhost:3000' } };\n");
    const io = capture();
    expect(await main(['migrate'], { ...io.io, cwd: dir })).toBe(0);
    expect(io.out).toContain('needs no changes');
    expect(existsSync(`${file}.backup`)).toBe(false);
  });

  it('reports unknown options it cannot migrate', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-migrate-'));
    writeFileSync(join(dir, 'hydration-proof.config.mjs'), "export default { routes: { paths: ['/'] }, frobnicate: true };\n");
    const io = capture();
    expect(await main(['migrate'], { ...io.io, cwd: dir })).toBe(2);
    expect(io.err).toContain('frobnicate');
  });

  it('exits 2 without a config file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-migrate-'));
    const io = capture();
    expect(await main(['migrate'], { ...io.io, cwd: dir })).toBe(2);
    expect(io.err).toContain('No config file found');
  });
});
