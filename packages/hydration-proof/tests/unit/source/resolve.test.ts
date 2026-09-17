import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codeFrame, isLibraryPath, normalizeSourcePath, SourceResolver, workspaceSourceOf } from '../../../src/source/resolve.ts';

describe('normalizeSourcePath', () => {
  it.each([
    ['webpack://_N_E/./app/page.tsx?1234', 'app/page.tsx'],
    ['webpack-internal:///(app-pages-browser)/./components/Clock.tsx', 'components/Clock.tsx'],
    ['turbopack:///[project]/app/page.tsx', 'app/page.tsx'],
    ['[project]/src/Clock.tsx', 'src/Clock.tsx'],
    ['file:///repo/app/page.tsx', '/repo/app/page.tsx'],
    ['app/page.tsx#x', 'app/page.tsx'],
  ])('%s -> %s', (input, output) => {
    expect(normalizeSourcePath(input)).toBe(output);
  });

  it('maps pnpm injected workspace packages back to their sources', () => {
    const path = '/repo/node_modules/.pnpm/@acme+ui@file+packages+ui_react@19.3.0/node_modules/@acme/ui/src/Button.tsx';
    expect(workspaceSourceOf(path)).toBe('/repo/packages/ui/src/Button.tsx');
    expect(isLibraryPath(path)).toBe(false);
    expect(isLibraryPath('/repo/node_modules/react/index.js')).toBe(true);
    expect(isLibraryPath('/repo/app/page.tsx')).toBe(false);
  });
});

describe('codeFrame', () => {
  it('marks the line and column', () => {
    const frame = codeFrame('a\nb\n\tconst x = 1;\nd\ne\nf', 3, 7);
    expect(frame).toBe(['  1 | a', '  2 | b', '> 3 |   const x = 1;', '    |        ^', '  4 | d', '  5 | e'].join('\n'));
  });
});

/** One mapping segment at `column` pointing to source 1, line 3 (relative to a first segment at 0/0/0/0). */
function vlqPair(column: number): string {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vlq = (value: number): string => {
    let v = value < 0 ? (-value << 1) | 1 : value << 1;
    let out = '';
    do {
      let digit = v & 31;
      v >>>= 5;
      if (v > 0) digit |= 32;
      out += digits[digit];
    } while (v > 0);
    return out;
  };
  return [column, 1, 2, 0].map(vlq).join('');
}

describe('SourceResolver', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves a bundled frame through a data: source map to a local file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-resolve-'));
    mkdirSync(join(dir, 'app', 'components'), { recursive: true });
    writeFileSync(join(dir, 'app', 'components', 'Clock.tsx'), 'export function Clock() {\n  return <p>{Date.now()}</p>;\n}\n');
    const map = { version: 3, sources: ['turbopack:///[project]/app/components/Clock.tsx'], mappings: 'AACE,UAAS' };
    const script = `console.log(1);\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
    const fetched: string[] = [];
    const resolver = new SourceResolver({
      rootDir: dir,
      fetchText: async (url) => {
        fetched.push(url);
        return url.endsWith('chunk.js') ? script : undefined;
      },
    });
    const resolved = await resolver.resolveCreationStack(
      [
        'Error: react-stack-top-frame',
        '    at exports.jsxDEV (http://localhost:3000/_next/static/chunks/react-jsx-dev-runtime.js:1:1)',
        '    at Clock (http://localhost:3000/_next/static/chunks/chunk.js:1:12)',
      ].join('\n'),
    );
    expect(resolved).toMatchObject({ file: 'app/components/Clock.tsx', line: 2, column: 12 });
    expect(resolved?.frame).toContain('> 2 |   return <p>{Date.now()}</p>;');
    // Cached: a second lookup does not fetch again.
    await resolver.resolveFrame({ name: 'Clock', url: 'http://localhost:3000/_next/static/chunks/chunk.js', line: 1, column: 12 });
    expect(fetched.filter((url) => url.endsWith('chunk.js'))).toHaveLength(1);
  });

  it('locates a component by its code in the loaded scripts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-resolve-'));
    const content = "'use client';\n\nexport function Stats() {\n  return <p>{Math.random()}</p>;\n}\n";
    const fn = 'function s(){return(0,r.jsx)("p",{children:Math.random()})}';
    const chunk = `(self.TURBOPACK=[]).push([1,e=>{var r=e.r(1);${fn};e.s(["Stats",()=>s])}]);`;
    const map = {
      version: 3,
      sources: ['turbopack:///[project]/node_modules/next/dist/client.js', 'turbopack:///[project]/app/Stats.jsx'],
      sourcesContent: [null, content],
      // column 0 -> library code; the function's first token -> Stats.jsx line 3.
      mappings: `AAAA,${vlqPair(chunk.indexOf(fn))}`,
    };
    const scripts: Record<string, string> = {
      'http://localhost/a.js': `${chunk}\n//# sourceMappingURL=a.js.map`,
      'http://localhost/a.js.map': JSON.stringify(map),
      'http://localhost/b.js': 'console.log("other")',
      'http://localhost/c.js': `${chunk}`,
    };
    const resolver = new SourceResolver({ rootDir: dir, fetchText: async (url) => scripts[url] });
    const resolved = await resolver.resolveFunction(fn, ['http://localhost/b.js', 'http://localhost/a.js']);
    expect(resolved).toMatchObject({ file: 'app/Stats.jsx', line: 3, scope: 'component' });
    expect(resolved?.content).toBe(content);
    // Found in two scripts: ambiguous, so no location.
    expect(await resolver.resolveFunction(fn, ['http://localhost/a.js', 'http://localhost/c.js'])).toBeUndefined();
    expect(await resolver.resolveFunction('function missing(){}', ['http://localhost/a.js'])).toBeUndefined();
    expect(await resolver.hasSourceMap('http://localhost/a.js')).toBe(true);
    expect(await resolver.hasSourceMap('http://localhost/b.js')).toBe(false);
  });

  it('finds bundler-relative paths in parent folders (monorepos)', () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-resolve-'));
    mkdirSync(join(dir, 'packages', 'ui'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'ui', 'Button.tsx'), 'line1\nline2\n');
    const resolver = new SourceResolver({ rootDir: join(dir, 'apps', 'web'), fetchText: async () => undefined });
    const resolved = resolver.fromFile('[project]/packages/ui/Button.tsx', 2, 0);
    expect(resolved.file).toBe('../../packages/ui/Button.tsx');
    expect(resolved.absolute).toBe(join(dir, 'packages', 'ui', 'Button.tsx'));
  });
});
