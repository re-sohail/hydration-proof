// The HTML report viewer. Plain DOM, no dependencies; data comes from the
// JSON embedded in the page. Text is always inserted with textContent.

import { myers } from '../../dom/myers.ts';
import type { Issue, PageResult, Report, TimelineEntry } from '../model.ts';
import { css } from './styles.ts';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | number | ((event: Event) => void) | undefined> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (key === 'className') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const dataElement = document.getElementById('hydration-proof-data');
const report = JSON.parse(dataElement?.textContent ?? '{}') as Report;
const issuesByFingerprint = new Map<string, Issue[]>();
for (const issue of report.issues) {
  const list = issuesByFingerprint.get(issue.fingerprint) ?? [];
  list.push(issue);
  issuesByFingerprint.set(issue.fingerprint, list);
}

function issuesOf(page: PageResult): Issue[] {
  const out: Issue[] = [];
  for (const fingerprint of page.issues) {
    for (const issue of issuesByFingerprint.get(fingerprint) ?? []) {
      if (issue.route.url === page.route.url && issue.scenario === page.scenario && (issue.mode ?? '') === (page.mode ?? '')) {
        out.push(issue);
      }
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

interface State {
  query: string;
  severities: Set<string>;
  statuses: Set<string>;
  cause: string;
  group: string;
  scenario: string;
  showIgnored: boolean;
  pageId: string | undefined;
  issue: string | undefined;
}

const state: State = {
  query: '',
  severities: new Set(['error', 'warning', 'info']),
  statuses: new Set(['failed', 'error', 'warning']),
  cause: '',
  group: '',
  scenario: '',
  showIgnored: false,
  pageId: undefined,
  issue: undefined,
};

function readHash(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  const page = params.get('page');
  if (page) state.pageId = page;
  const issue = params.get('issue');
  if (issue) state.issue = issue;
}

function writeHash(): void {
  const params = new URLSearchParams();
  if (state.pageId) params.set('page', state.pageId);
  if (state.issue) params.set('issue', state.issue);
  history.replaceState(null, '', `#${params.toString()}`);
}

function issueVisible(issue: Issue): boolean {
  if (issue.ignored && !state.showIgnored) return false;
  if (!state.severities.has(issue.severity)) return false;
  if (state.cause && issue.cause?.id !== state.cause) return false;
  if (state.group && !issue.code.startsWith(state.group)) return false;
  if (state.query) {
    const haystack = [issue.code, issue.title, issue.message, issue.selector, issue.component, issue.source?.file, issue.route.url, issue.cause?.title]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(state.query.toLowerCase())) return false;
  }
  return true;
}

function pageVisible(page: PageResult): boolean {
  if (state.scenario && page.scenario !== state.scenario) return false;
  const filtering = state.query !== '' || state.cause !== '' || state.group !== '';
  if (filtering) return issuesOf(page).some(issueVisible);
  return state.statuses.has(page.status);
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function copyButton(text: string, label = 'Copy'): HTMLButtonElement {
  const button = h('button', { className: 'copy', type: 'button', title: `Copy ${text}` }, label);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    void navigator.clipboard?.writeText(text).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = label), 1200);
    });
  });
  return button;
}

function charDiff(a: string, b: string): [Node[], Node[]] {
  if (a.length * b.length > 250_000) return [[document.createTextNode(a)], [document.createTextNode(b)]];
  const left: Node[] = [];
  const right: Node[] = [];
  let pendingDel = '';
  let pendingIns = '';
  let same = '';
  const flush = (): void => {
    if (same) {
      left.push(document.createTextNode(same));
      right.push(document.createTextNode(same));
      same = '';
    }
  };
  const flushChanges = (): void => {
    if (pendingDel) left.push(h('del', {}, pendingDel));
    if (pendingIns) right.push(h('ins', {}, pendingIns));
    pendingDel = '';
    pendingIns = '';
  };
  for (const edit of myers([...a], [...b])) {
    if (edit.op === 'equal') {
      flushChanges();
      same += a[edit.a];
    } else {
      flush();
      if (edit.op === 'delete') pendingDel += a[edit.a];
      else pendingIns += b[edit.b];
    }
  }
  flushChanges();
  flush();
  return [left, right];
}

function valueText(value: string | null | undefined): string {
  return value === null || value === undefined ? '(absent)' : value;
}

function compare(serverTitle: string, server: string, clientTitle: string, client: string, diff: boolean): HTMLElement {
  const [left, right] = diff ? charDiff(server, client) : [[document.createTextNode(server)], [document.createTextNode(client)]];
  return h(
    'div',
    { className: 'compare' },
    h('div', {}, h('h4', {}, serverTitle), h('pre', {}, left)),
    h('div', {}, h('h4', {}, clientTitle), h('pre', {}, right)),
  );
}

function issueView(issue: Issue, open: boolean): HTMLElement {
  const summary = h(
    'summary',
    {},
    h('span', { className: `badge ${issue.severity}` }, issue.code),
    h('span', { className: 'issue-title' }, issue.title),
    issue.cause ? h('span', { className: 'cause', title: 'Likely cause' }, `${issue.cause.title} · ${Math.round(issue.cause.confidence * 100)}%`) : null,
    issue.ignored ? h('span', { className: 'cause' }, 'ignored') : null,
    h(
      'span',
      { className: 'where mono' },
      [issue.selector, issue.component ? `in ${issue.component}` : '', issue.source ? `${issue.source.file}:${issue.source.line}` : '']
        .filter(Boolean)
        .join('   '),
    ),
  );

  const body = h('div', { className: 'issue-body' });
  body.append(h('p', {}, issue.message));
  if (issue.ignored) body.append(h('p', { className: 'small' }, `Ignored by ${issue.ignored.rule}: ${issue.ignored.reason}`));

  if (issue.server !== undefined || issue.client !== undefined) {
    const label = issue.attribute ? ` (${issue.attribute})` : '';
    body.append(compare(`Server HTML${label}`, valueText(issue.server), `Client render${label}`, valueText(issue.client), true));
  }
  if (issue.excerpt && (issue.excerpt.server || issue.excerpt.client)) {
    body.append(compare('Server element', issue.excerpt.server ?? '(none)', 'Client element', issue.excerpt.client ?? '(none)', false));
  }

  const facts = h('dl', { className: 'kv' });
  const fact = (term: string, ...value: Child[]): void => {
    facts.append(h('dt', {}, term), h('dd', {}, ...value));
  };
  if (issue.selector) fact('Selector', h('code', {}, issue.selector), ' ', copyButton(issue.selector));
  if (issue.domPath?.length) fact('Path', h('code', {}, issue.domPath.join(' > ')));
  if (issue.component) fact('Component', h('code', {}, issue.component));
  if (issue.source) fact('Source', h('code', {}, `${issue.source.file}:${issue.source.line}${issue.source.column ? `:${issue.source.column}` : ''}`));
  else if (issue.sourceUnavailableReason) fact('Source', h('span', { className: 'small' }, issue.sourceUnavailableReason));
  fact('Stage', issue.stage);
  fact('Confidence', `${Math.round(issue.confidence * 100)}%`);
  fact('Fingerprint', h('code', {}, issue.fingerprint), ' ', copyButton(issue.fingerprint));
  body.append(facts);

  if (issue.source?.frame) body.append(h('pre', { className: 'frame' }, issue.source.frame));
  if (issue.componentStack) {
    body.append(h('details', {}, h('summary', { className: 'small' }, 'Component stack'), h('pre', { className: 'frame' }, issue.componentStack)));
  }
  if (issue.suggestions.length > 0) {
    body.append(h('div', { className: 'section-title' }, 'How to fix'), h('ul', { className: 'plain' }, issue.suggestions.map((line) => h('li', {}, line))));
  }
  if (issue.evidence.length > 0) {
    body.append(
      h('div', { className: 'section-title' }, 'Evidence'),
      h(
        'ul',
        { className: 'plain' },
        issue.evidence.map((entry) =>
          h('li', {}, entry.message, entry.detail ? h('details', {}, h('summary', { className: 'small' }, 'details'), h('pre', { className: 'frame' }, entry.detail)) : null),
        ),
      ),
    );
  }
  const links = [h('a', { href: issue.docsUrl, target: '_blank', rel: 'noreferrer' }, `About ${issue.code}`)];
  if (issue.cause?.docsUrl) links.push(h('a', { href: issue.cause.docsUrl, target: '_blank', rel: 'noreferrer' }, `About ${issue.cause.title.toLowerCase()}`));
  body.append(h('p', { className: 'small' }, links.flatMap((link, index) => (index === 0 ? [link] : [' · ', link]))));

  const details = h('details', { className: `issue ${issue.severity}${issue.ignored ? ' ignored' : ''}`, id: `issue-${issue.fingerprint}` }, summary, body);
  details.open = open;
  details.addEventListener('toggle', () => {
    if (details.open) {
      state.issue = issue.fingerprint;
      writeHash();
      highlight(issue.fingerprint);
    }
  });
  return details;
}

let boxes: HTMLElement[] = [];

function highlight(fingerprint: string): void {
  for (const box of boxes) box.classList.toggle('active', box.dataset['fingerprint'] === fingerprint);
}

function screenshots(page: PageResult): HTMLElement | null {
  const shots = page.screenshots;
  if (!shots || (!shots.hydrated && !shots.server)) return null;
  const wrap = h('div');
  const frame = h('div', { className: 'shot' });
  const image = h('img', { alt: 'Screenshot of the page', loading: 'lazy' });
  boxes = [];
  const show = (which: 'hydrated' | 'server'): void => {
    const src = shots[which];
    if (!src) return;
    image.src = src;
    for (const box of boxes) box.hidden = which !== 'hydrated';
  };
  image.addEventListener('load', () => {
    const scale = image.clientWidth / image.naturalWidth;
    const ratio = image.naturalWidth / shots.width || 1;
    for (const box of boxes) {
      const x = Number(box.dataset['x']);
      const y = Number(box.dataset['y']);
      const w = Number(box.dataset['w']);
      const hgt = Number(box.dataset['h']);
      Object.assign(box.style, {
        left: `${x * ratio * scale}px`,
        top: `${y * ratio * scale}px`,
        width: `${w * ratio * scale}px`,
        height: `${hgt * ratio * scale}px`,
      });
    }
  });
  frame.append(image);
  for (const box of shots.boxes) {
    const el = h('div', { className: 'box', 'data-fingerprint': box.fingerprint, 'data-x': box.x, 'data-y': box.y, 'data-w': box.width, 'data-h': box.height });
    boxes.push(el);
    frame.append(el);
  }
  const buttons = h('div', { className: 'shots', role: 'group', 'aria-label': 'Screenshot' });
  const make = (which: 'hydrated' | 'server', label: string): void => {
    if (!shots[which]) return;
    const button = h('button', { className: 'chip', type: 'button', 'aria-pressed': which === 'hydrated' ? 'true' : 'false' }, label);
    button.addEventListener('click', () => {
      for (const other of buttons.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      show(which);
    });
    buttons.append(button);
  };
  make('hydrated', 'After hydration');
  make('server', 'Server HTML (no scripts)');
  wrap.append(h('div', { className: 'section-title' }, 'Screenshots'), buttons, frame);
  show(shots.hydrated ? 'hydrated' : 'server');
  return wrap;
}

function timeline(entries: TimelineEntry[] | undefined): HTMLElement | null {
  if (!entries || entries.length === 0) return null;
  return h(
    'details',
    {},
    h('summary', { className: 'section-title' }, 'Timeline'),
    h(
      'ol',
      { className: 'timeline' },
      entries.map((entry) =>
        h('li', { className: entry.kind }, h('time', {}, `${entry.time.toFixed(0)}ms`), entry.label, entry.detail ? h('span', { className: 'small' }, ` — ${entry.detail}`) : null),
      ),
    ),
  );
}

function pageDetail(page: PageResult | undefined): HTMLElement {
  if (!page) return h('div', { className: 'empty' }, report.pages.length === 0 ? 'No pages were tested.' : 'Select a page.');
  const issues = issuesOf(page).filter(issueVisible);
  const hiddenCount = issuesOf(page).length - issues.length;
  const react = page.react ? `React ${page.react.version} (${page.react.build})` : 'No React';
  const facts = [
    `Scenario: ${page.scenario}`,
    page.mode ? `Mode: ${page.mode}` : '',
    page.http ? `HTTP ${page.http.status}` : '',
    react,
    `Outcome: ${page.outcome}`,
    `${page.timings.total}ms`,
  ].filter(Boolean);
  const detail = h(
    'div',
    {},
    h(
      'div',
      { className: 'page-head' },
      h('h2', {}, pathOf(page.url)),
      h('div', { className: 'meta' }, facts.map((fact) => h('span', {}, fact))),
      h('div', { className: 'meta' }, h('a', { href: page.url, target: '_blank', rel: 'noreferrer' }, page.url)),
    ),
  );
  detail.append(h('div', { className: 'section-title' }, `Issues (${issues.length}${hiddenCount ? `, ${hiddenCount} hidden by filters` : ''})`));
  if (issues.length === 0) detail.append(h('p', { className: 'empty' }, 'No issues match the filters.'));
  issues.forEach((issue, index) => detail.append(issueView(issue, state.issue ? state.issue === issue.fingerprint : index === 0)));
  const shots = screenshots(page);
  if (shots) detail.append(shots);
  const events = timeline(page.timeline);
  if (events) detail.append(events);
  return detail;
}

const listElement = h('nav', { className: 'pages', 'aria-label': 'Pages' });
const detailElement = h('main', { className: 'detail' });

function renderList(): void {
  listElement.replaceChildren();
  const visible = report.pages.filter(pageVisible);
  if (!state.pageId || !visible.some((page) => page.id === state.pageId)) state.pageId = visible[0]?.id;
  if (visible.length === 0) listElement.append(h('p', { className: 'empty' }, 'No pages match.'));
  for (const page of visible) {
    const counts: Node[] = [];
    if (page.counts.error) counts.push(h('span', { className: 'count' }, String(page.counts.error)));
    if (page.counts.warning) counts.push(h('span', { className: 'count warning' }, String(page.counts.warning)));
    const item = h(
      'button',
      { className: 'page-item', type: 'button', 'aria-current': page.id === state.pageId ? 'true' : 'false' },
      h('span', { className: `dot ${page.status}`, title: page.status }),
      h('span', {}, h('div', { className: 'path' }, pathOf(page.url)), h('div', { className: 'scenario' }, [page.scenario, page.mode].filter(Boolean).join(' · '))),
      h('span', {}, counts),
    );
    item.addEventListener('click', () => {
      state.pageId = page.id;
      state.issue = undefined;
      writeHash();
      render();
    });
    listElement.append(item);
  }
}

function render(): void {
  renderList();
  detailElement.replaceChildren(pageDetail(report.pages.find((page) => page.id === state.pageId)));
  if (state.issue) document.getElementById(`issue-${state.issue}`)?.scrollIntoView({ block: 'nearest' });
}

function chipGroup(values: [string, string][], selected: Set<string>, label: string): HTMLElement {
  const group = h('span', { role: 'group', 'aria-label': label, className: 'group' }, h('span', { className: 'group-label' }, label));
  for (const [value, text] of values) {
    const chip = h('button', { className: 'chip', type: 'button', 'aria-pressed': selected.has(value) ? 'true' : 'false' }, text);
    chip.addEventListener('click', () => {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      chip.setAttribute('aria-pressed', selected.has(value) ? 'true' : 'false');
      render();
    });
    group.append(chip);
  }
  return group;
}

function select(label: string, options: [string, string][], onChange: (value: string) => void): HTMLElement {
  const element = h('select', { 'aria-label': label }, h('option', { value: '' }, label), options.map(([value, text]) => h('option', { value }, text)));
  element.addEventListener('change', () => {
    onChange(element.value);
    render();
  });
  return element;
}

function header(): HTMLElement {
  const { summary, run } = report;
  const tiles: [string, number, string][] = [
    ['Pages tested', summary.pages, ''],
    ['Passed', summary.passed, 'ok'],
    ['Passed with warnings', summary.warnings, summary.warnings ? 'warning' : ''],
    ['Failed', summary.failed + summary.errored, summary.failed + summary.errored ? 'error' : ''],
    ['Error issues', summary.issues.error, summary.issues.error ? 'error' : ''],
    ['Warning issues', summary.issues.warning, summary.issues.warning ? 'warning' : ''],
    ['Info', summary.issues.info, ''],
    ['Ignored', summary.ignored, ''],
  ];
  return h(
    'header',
    { className: 'header' },
    h('h1', {}, 'Hydration Proof report'),
    h(
      'div',
      { className: 'meta' },
      [
        new Date(run.startedAt).toLocaleString(),
        `${(run.durationMs / 1000).toFixed(1)}s`,
        run.baseUrl ?? '',
        `mode: ${run.mode}`,
        run.browsers.join(', '),
        `hydration-proof ${report.tool.version}`,
      ]
        .filter(Boolean)
        .map((text) => h('span', {}, text)),
    ),
    h('div', { className: 'tiles' }, tiles.map(([label, value, tone]) => h('div', { className: `tile ${tone}` }, h('b', {}, String(value)), h('span', {}, label)))),
  );
}

function toolbar(): HTMLElement {
  const search = h('input', { type: 'search', placeholder: 'Search issues, selectors, components, files…', 'aria-label': 'Search' });
  search.addEventListener('input', () => {
    state.query = search.value.trim();
    render();
  });
  const causes = new Map<string, string>();
  for (const issue of report.issues) if (issue.cause) causes.set(issue.cause.id, issue.cause.title);
  const scenarios = [...new Set(report.pages.map((page) => page.scenario))];
  const ignored = h('input', { type: 'checkbox' });
  ignored.addEventListener('change', () => {
    state.showIgnored = ignored.checked;
    render();
  });
  return h(
    'div',
    { className: 'toolbar' },
    search,
    chipGroup([['failed', 'Failed'], ['warning', 'Warnings'], ['passed', 'Passed'], ['error', 'Not loaded']], state.statuses, 'Pages'),
    chipGroup([['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Info']], state.severities, 'Issues'),
    causes.size > 0 ? select('All causes', [...causes], (value) => (state.cause = value)) : null,
    select('All kinds', [['HP1', 'DOM mismatches'], ['HP2', 'React errors'], ['HP3', 'Invalid HTML'], ['HP4', 'External changes'], ['HP6', 'Suppression'], ['HP9', 'Test problems']], (value) => (state.group = value)),
    scenarios.length > 1 ? select('All scenarios', scenarios.map((name) => [name, name]), (value) => (state.scenario = value)) : null,
    h('label', {}, ignored, 'Show ignored'),
  );
}

function footer(): HTMLElement {
  const { run } = report;
  return h(
    'footer',
    {},
    `Node ${run.node} · ${run.platform} · Playwright ${run.playwright}${run.ci ? ` · ${run.ci}` : ''} · `,
    h('a', { href: 'https://hydration.jscrate.dev', target: '_blank', rel: 'noreferrer' }, 'hydration.jscrate.dev'),
  );
}

function start(): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  readHash();
  if (report.pages.every((page) => page.status === 'passed')) state.statuses.add('passed');
  // A linked page stays visible whatever its status.
  const linked = report.pages.find((page) => page.id === state.pageId);
  if (linked) state.statuses.add(linked.status);
  const app = document.getElementById('app') ?? document.body;
  app.replaceChildren(header(), toolbar(), h('div', { className: 'layout' }, listElement, detailElement), footer());
  render();
}

start();
