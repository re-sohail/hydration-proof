import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Report } from '../../../src/report/model.ts';
import { junitReporter, renderJunit, stripInvalidXml, xmlAttr, xmlText } from '../../../src/report/reporters/junit.ts';
import { CONTROL, LONE_SURROGATE, NASTY, expectGolden, issue, makeConfig, makeContext, makeReport, makeWorkspace, page } from './fixture.ts';
import { findAll, isXmlChar, parseXml, type XmlElement } from './xml.ts';

const workspace = makeWorkspace();
afterAll(() => workspace.cleanup());

function cases(root: XmlElement): XmlElement[] {
  return findAll(root, 'testcase');
}

/** Every UTF-16 code unit from 0 to 0x2FF, the surrogates and the non-characters. */
function allTheCharacters(): string {
  let text = '';
  for (let code = 0; code <= 0x2ff; code++) text += String.fromCharCode(code);
  return `${text}${LONE_SURROGATE}${String.fromCharCode(0xdc00, 0xdbff, 0xfffe, 0xffff)}🎉${String.fromCharCode(0xd83c)}x`;
}

describe('XML escaping', () => {
  it('escapes markup and keeps "]]>" out of text', () => {
    expect(xmlText('a < b && c > d ]]> e')).toBe('a &lt; b &amp;&amp; c &gt; d ]]&gt; e');
    expect(xmlText('line\r\nnext')).toBe('line&#13;\nnext');
  });

  it('escapes quotes and whitespace in attributes', () => {
    expect(xmlAttr(`"it's"\t<a>\n&`)).toBe('&quot;it&apos;s&quot;&#9;&lt;a&gt;&#10;&amp;');
  });

  it('removes characters XML 1.0 cannot contain, but keeps valid astral characters', () => {
    expect(stripInvalidXml(`a${CONTROL}b\tc\nd${LONE_SURROGATE}e🎉${String.fromCharCode(0xdc00)}`)).toBe('ab\tc\nde🎉');
    const stripped = stripInvalidXml(allTheCharacters());
    for (const char of stripped) expect(isXmlChar(char.codePointAt(0)!), `U+${char.codePointAt(0)!.toString(16)}`).toBe(true);
  });

  it('round-trips any string through an attribute and text, minus the invalid characters', () => {
    const value = allTheCharacters();
    const root = parseXml(`<r a="${xmlAttr(value)}">${xmlText(value)}</r>`);
    expect(root.attributes['a']).toBe(stripInvalidXml(value));
    expect(root.text).toBe(stripInvalidXml(value));
  });
});

describe('JUnit reporter', () => {
  const config = makeConfig(workspace);

  it('matches the golden file', () => {
    expectGolden('junit.xml', renderJunit(makeReport()));
  });

  it('writes well-formed XML with consistent counts', () => {
    const root = parseXml(renderJunit(makeReport()));
    expect(root.name).toBe('testsuites');
    expect(root.attributes).toMatchObject({ name: 'hydration-proof', tests: '7', failures: '4', errors: '1', skipped: '0', time: '12.345' });
    expect(root.attributes['timestamp']).toBe('2026-09-17T10:00:00');
    const suites = findAll(root, 'testsuite');
    expect(suites.map((suite) => suite.attributes['name'])).toEqual(['guest (production)', 'admin (production)', 'guest (development)']);
    let tests = 0;
    for (const suite of suites) {
      const own = cases(suite);
      tests += own.length;
      expect(suite.attributes['tests']).toBe(String(own.length));
      expect(suite.attributes['failures']).toBe(String(own.filter((test) => findAll(test, 'failure').length > 0).length));
      expect(suite.attributes['errors']).toBe(String(own.filter((test) => findAll(test, 'error').length > 0).length));
    }
    expect(tests).toBe(7);
  });

  it('maps page status to failure, error and passing cases', () => {
    const root = parseXml(renderJunit(makeReport()));
    const byName = new Map(cases(root).map((test) => [`${test.attributes['classname']} ${test.attributes['name']}`, test]));
    expect([...byName.keys()]).toEqual([
      'hydration-proof.guest.production /',
      'hydration-proof.guest.production /products/1?ref=a,b',
      'hydration-proof.guest.production /docs',
      'hydration-proof.guest.production /nasty',
      'hydration-proof.guest.production /broken',
      'hydration-proof.admin.production /products/1?ref=a,b',
      'hydration-proof.guest.development /products/1?ref=a,b',
    ]);

    expect(byName.get('hydration-proof.guest.production /')!.children).toEqual([]);
    expect(byName.get('hydration-proof.guest.production /')!.attributes['time']).toBe('0.812');

    const product = byName.get('hydration-proof.guest.production /products/1?ref=a,b')!;
    const failure = findAll(product, 'failure')[0]!;
    expect(failure.attributes['type']).toBe('HP1001');
    expect(failure.attributes['message']).toBe(
      '2 hydration errors: HP1001 Text differs between server and client; HP1004 Class name differs between server and client',
    );
    expect(failure.text).toContain('Server: "Price: 10%\\nnow"');
    expect(failure.text).toContain('Source: src/app/products/[id]/page.tsx:12:7');
    expect(failure.text).toContain('Likely cause: Time-dependent value (97% confidence)');
    expect(failure.text).not.toContain('HP1005');
    expect(findAll(product, 'system-out')[0]!.text).toContain('HP1005 Attribute only present in the server HTML');

    const docs = byName.get('hydration-proof.guest.production /docs')!;
    expect(findAll(docs, 'failure')).toEqual([]);
    expect(findAll(docs, 'system-out')[0]!.text).toContain('Warnings:\n\nHP9010');
    expect(findAll(docs, 'system-out')[0]!.text).toContain('Final URL: http://127.0.0.1:4173/login');

    const broken = byName.get('hydration-proof.guest.production /broken')!;
    const error = findAll(broken, 'error')[0]!;
    expect(error.attributes['type']).toBe('navigation-failed');
    expect(error.attributes['message']).toBe('navigation-failed: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/broken');
    expect(findAll(broken, 'failure')).toEqual([]);

    const nasty = byName.get('hydration-proof.guest.production /nasty')!;
    expect(findAll(nasty, 'failure')[0]!.text).not.toContain('HP1002');
    expect(findAll(nasty, 'system-out')[0]!.text).toContain('Ignored issues:\n\nHP1002');
    expect(findAll(nasty, 'system-err')[0]!.text).toBe('Server log:\nError: <boom> & failed\nbad  bytes');
  });

  it('keeps nasty values readable: quoted with visible escapes', () => {
    const root = parseXml(renderJunit(makeReport()));
    const nasty = cases(root).find((test) => test.attributes['name'] === '/nasty')!;
    const text = findAll(nasty, 'failure')[0]!.text;
    const slash = '\\';
    const visible = JSON.stringify(NASTY)
      .replace(String.fromCharCode(0x7f), `${slash}u007f`)
      .replace(String.fromCharCode(0x85), `${slash}u0085`)
      .replace(String.fromCharCode(0x9f), `${slash}u009f`);
    expect(visible).toContain(`${slash}u0000${slash}u0007${slash}b${slash}u000b${slash}f${slash}u001b${slash}u007f${slash}u0085${slash}u009f`);
    expect(text).toContain(`Server: ${visible}`);
    expect(text).toContain('Fix: Sanitize <html> & use `useEffect` | done.');
  });

  it('does not count ignored errors as failures', () => {
    const ignored = issue('HP1001', { url: '/a', scenario: 'default', ignored: { reason: 'known', rule: 'r' } });
    const report: Report = { ...makeReport(), pages: [page('/a', 'default', [ignored])], issues: [ignored] };
    const root = parseXml(renderJunit(report));
    expect(root.attributes['failures']).toBe('0');
    expect(findAll(root, 'failure')).toEqual([]);
    expect(findAll(root, 'system-out')[0]!.text).toContain('Ignored: known (r)');
  });

  it('makes classname + name unique', () => {
    const report: Report = {
      ...makeReport(),
      pages: [
        page('/same', 'default', []),
        page('/same', 'default', []),
        page('/same#top', 'default', []),
        page('/same', 'other', []),
        page('/same', 'default', []),
      ],
      issues: [],
    };
    const root = parseXml(renderJunit(report));
    const pairs = cases(root).map((test) => `${test.attributes['classname']}|${test.attributes['name']}`);
    expect(pairs).toEqual([
      'hydration-proof.default|/same',
      'hydration-proof.default|/same (2)',
      'hydration-proof.default|/same (3)',
      'hydration-proof.default|/same (4)',
      'hydration-proof.other|/same',
    ]);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('stays well-formed when every text field is hostile', () => {
    const hostile = allTheCharacters();
    const bad = issue('HP1001', {
      url: '/x',
      scenario: hostile,
      title: hostile as never,
      message: hostile,
      selector: hostile,
      server: hostile,
      client: hostile,
      source: { file: hostile, line: 1 },
      suggestions: [hostile],
      docsUrl: hostile,
    });
    const report: Report = {
      ...makeReport(),
      pages: [page('/x', hostile, [bad], { outcome: hostile, serverLogs: [hostile] }), page('/y', hostile, [], { status: 'error', outcome: hostile })],
      issues: [bad],
    };
    const root = parseXml(renderJunit(report));
    expect(cases(root)).toHaveLength(2);
    expect(findAll(root, 'testsuite')[0]!.attributes['name']).toBe(stripInvalidXml(hostile));
  });

  it('handles empty and incomplete reports', () => {
    const empty = parseXml(renderJunit({ ...makeReport(), pages: [], issues: [] }));
    expect(empty.attributes['tests']).toBe('0');
    const broken = { schemaVersion: 1, pages: [{ status: 'failed' }, null], issues: [null, {}] } as unknown as Report;
    const root = parseXml(renderJunit(broken));
    expect(cases(root)).toHaveLength(1);
    expect(findAll(root, 'failure')[0]!.attributes['message']).toBe('0 hydration errors');
  });

  it('writes junit.xml into the output directory', async () => {
    const context = makeContext(config);
    const files = await junitReporter().onEnd!(makeReport(), context);
    const file = join(workspace.outputDir, 'junit.xml');
    expect(files).toEqual([file]);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(renderJunit(makeReport()));
  });
});
