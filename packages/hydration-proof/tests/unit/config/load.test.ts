import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, findConfigFile, loadConfig } from '../../../src/config/load.ts';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function project(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'hp-config-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('loadConfig', () => {
  it('returns an empty config when there is no file', async () => {
    const cwd = project({});
    expect(await loadConfig({ cwd })).toEqual({ config: {}, file: undefined, rootDir: cwd });
  });

  // TypeScript configs are loaded by Node itself (type stripping), so these
  // run in a plain Node process instead of Vitest's module runner.
  const loadInNode = (cwd: string): { ok: boolean; output: string } => {
    const loader = new URL('../../../src/config/load.ts', import.meta.url).href;
    const script = `const { loadConfig } = await import(${JSON.stringify(loader)});
try { const r = await loadConfig({ cwd: ${JSON.stringify(cwd)} }); console.log(JSON.stringify(r.config)); }
catch (e) { console.log('ERROR ' + e.message); }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    const output = `${result.stdout}${result.stderr}`.trim();
    return { ok: !output.startsWith('ERROR'), output };
  };

  it('loads a TypeScript config natively', () => {
    const cwd = project({
      'hydration-proof.config.ts': `interface Shape { workers: number }\nconst config: Shape = { workers: 3 };\nexport default config;\n`,
    });
    expect(loadInNode(cwd)).toEqual({ ok: true, output: '{"workers":3}' });
  });

  it('explains TypeScript syntax Node cannot strip', () => {
    const cwd = project({ 'hydration-proof.config.ts': 'enum Mode { A }\nexport default { workers: Mode.A + 1 };' });
    expect(loadInNode(cwd).output).toMatch(/TypeScript syntax that Node.js cannot strip/);
  });

  it('loads JSON and function exports', async () => {
    let cwd = project({ 'hydration-proof.config.json': '{ "workers": 2 }' });
    expect((await loadConfig({ cwd })).config).toEqual({ workers: 2 });
    rmSync(dir, { recursive: true, force: true });
    cwd = project({ 'hydration-proof.config.mjs': 'export default async () => ({ retries: 2 });' });
    expect((await loadConfig({ cwd })).config).toEqual({ retries: 2 });
  });

  it('prefers .ts over other extensions', () => {
    const cwd = project({ 'hydration-proof.config.json': '{}', 'hydration-proof.config.ts': 'export default {}' });
    expect(findConfigFile(cwd)).toBe(join(cwd, 'hydration-proof.config.ts'));
  });

  it('explains invalid configs, unsupported syntax and missing exports', async () => {
    let cwd = project({ 'hydration-proof.config.mjs': 'export default { wrokers: 2 };' });
    await expect(loadConfig({ cwd })).rejects.toThrow(/wrokers is not a known option\. Did you mean "workers"\?/);
    rmSync(dir, { recursive: true, force: true });
    cwd = project({ 'hydration-proof.config.mjs': 'export const other = 1;' });
    await expect(loadConfig({ cwd })).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig({ cwd, file: 'missing.ts' })).rejects.toThrow(/not found/);
  });
});
