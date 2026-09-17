import { describe, expect, it } from 'vitest';
import { analyzeMarkup } from '../../../src/analyze/markup.ts';
import { checkNesting, emptyAncestorInfo, updatedAncestorInfo } from '../../../src/dom/nesting.ts';
import { rawAttr, rawElements, tokenizeHtml } from '../../../src/dom/tokenize.ts';
import { doc, el, resetIds, text } from '../../helpers/tree.ts';

describe('tokenizeHtml', () => {
  it('keeps the nesting as written, with positions', () => {
    const root = tokenizeHtml('<!doctype html>\n<html><body><p id="a"><div class=x>hi</div></p><br><img src="y"/></body></html>');
    const tags = [...rawElements(root)].map((element) => element.tag);
    expect(tags).toEqual(['html', 'body', 'p', 'div', 'br', 'img']);
    const div = [...rawElements(root)].find((element) => element.tag === 'div')!;
    expect(div.parent?.tag).toBe('p');
    expect(rawAttr(div, 'class')).toBe('x');
    expect(div.line).toBe(2);
  });

  it('skips raw text elements and comments', () => {
    const root = tokenizeHtml('<script>if (a < b) { document.write("<div>") }</script><!-- <p> --><style>p>div{}</style><span></span>');
    expect([...rawElements(root)].map((element) => element.tag)).toEqual(['script', 'style', 'span']);
  });

  it('keeps SVG case and self-closing foreign elements', () => {
    const root = tokenizeHtml('<svg viewBox="0 0 1 1"><linearGradient id="g"/><foreignObject><div></div></foreignObject></svg>');
    const tags = [...rawElements(root)].map((element) => element.tag);
    expect(tags).toEqual(['svg', 'linearGradient', 'foreignObject', 'div']);
  });
});

describe('nesting rules (React validateDOMNesting)', () => {
  const check = (parents: string[], tag: string) => {
    let info = updatedAncestorInfo<string>(null, '#document', '#document');
    for (const parent of parents) info = updatedAncestorInfo(info, parent, parent);
    return checkNesting(tag, info, tag);
  };

  it.each([
    [['html', 'body', 'p'], 'div', 'p'],
    [['html', 'body', 'a', 'span'], 'a', 'a'],
    [['html', 'body', 'button'], 'button', 'button'],
    [['html', 'body', 'table'], 'tr', 'table'],
    [['html', 'body', 'form', 'div'], 'form', 'form'],
    [['html', 'body', 'ul', 'li', 'div'], 'li', 'li'],
  ])('%j > %s is invalid (culprit <%s>)', (parents, tag, culprit) => {
    expect(check(parents, tag)?.ancestorTag).toBe(culprit);
  });

  it.each([
    [['html', 'body', 'p'], 'span'],
    [['html', 'body', 'table', 'tbody'], 'tr'],
    [['html', 'body', 'button', 'table', 'tbody', 'tr', 'td'], 'button'],
    [['html', 'body', 'ul', 'li', 'ul'], 'li'],
  ])('%j > %s is valid', (parents, tag) => {
    expect(check(parents, tag)).toBeNull();
  });

  it('starts from an empty info', () => {
    expect(emptyAncestorInfo().current).toBeNull();
  });
});

describe('analyzeMarkup', () => {
  it('reports invalid nesting and whether the browser repaired it', () => {
    resetIds();
    const html = '<html><head></head><body><main><p id="outer"><div id="inner">x</div></p></main></body></html>';
    // What a browser builds from that markup:
    const parsed = doc([
      el('html', {}, [
        el('head'),
        el('body', {}, [el('main', {}, [el('p', { id: 'outer' }), el('div', { id: 'inner' }, [text('x')]), el('p')])]),
      ]),
    ]);
    const drafts = analyzeMarkup(html, parsed);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ code: 'HP3001', severity: 'error', selector: '#outer' });
    expect(drafts[0]?.related).toEqual(expect.arrayContaining(['#outer', '#inner']));
  });

  it('reports nested links as interactive nesting', () => {
    resetIds();
    const html = '<body><a id="x" href="/a"><span><a href="/b">b</a></span></a></body>';
    const parsed = doc([el('html', {}, [el('head'), el('body', {}, [el('a', { id: 'x', href: '/a' }, [el('span')]), el('span', {}, [el('a', { href: '/b' }, [text('b')])])])])]);
    const drafts = analyzeMarkup(html, parsed);
    expect(drafts[0]?.code).toBe('HP3002');
  });

  it('finds nothing in valid markup', () => {
    resetIds();
    expect(analyzeMarkup('<body><p>ok</p></body>', doc([el('html', {}, [el('head'), el('body', {}, [el('p', {}, [text('ok')])])])]))).toEqual([]);
  });
});
