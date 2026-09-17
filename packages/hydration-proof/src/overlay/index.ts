// Development overlay: a small panel that shows the hydration findings of the
// current page. Injected by `hydration-proof dev`; never part of the app.

import { OVERLAY_BINDING, OVERLAY_GLOBAL, OVERLAY_TAG, type OverlayAction, type OverlayIssue, type OverlayState } from '../shared/overlay.ts';

const CSS = `
:host { all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color-scheme: light dark; }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.badge { display: flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 8px 14px; background: #1b1d22; color: #fff; box-shadow: 0 4px 16px rgb(0 0 0 / 25%); }
.badge.error { background: #c62a2a; }
.badge.warning { background: #9a6200; }
.badge.ok { background: #1d7a46; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .8; }
.panel { position: absolute; right: 0; bottom: 48px; width: min(520px, calc(100vw - 32px)); max-height: min(70vh, 640px); overflow: auto; background: Canvas; color: CanvasText; border: 1px solid rgb(128 128 128 / 35%); border-radius: 10px; box-shadow: 0 12px 40px rgb(0 0 0 / 30%); }
.head { position: sticky; top: 0; display: flex; gap: 8px; align-items: center; padding: 10px 12px; background: Canvas; border-bottom: 1px solid rgb(128 128 128 / 25%); }
.head b { flex: 1; }
.tool { border: 1px solid rgb(128 128 128 / 40%); background: transparent; color: inherit; border-radius: 6px; padding: 3px 8px; }
.issue { padding: 10px 12px; border-bottom: 1px solid rgb(128 128 128 / 20%); }
.code { font: 600 11px ui-monospace, Menlo, monospace; border-radius: 4px; padding: 1px 5px; margin-right: 6px; }
.error .code, .code.error { background: #fdecec; color: #c62a2a; }
.code.warning { background: #fff4dc; color: #9a6200; }
.code.info { background: #e6f3fa; color: #25709a; }
.meta { color: GrayText; font-size: 12px; margin-top: 3px; word-break: break-word; }
.values { display: grid; grid-template-columns: max-content 1fr; gap: 2px 8px; margin: 6px 0; font: 12px ui-monospace, Menlo, monospace; }
.values span:nth-child(odd) { color: GrayText; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.fix { margin: 6px 0 0; font-size: 12px; }
.empty { padding: 16px 12px; color: GrayText; }
`;

type Child = Node | string | null | undefined | false;

function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function send(action: OverlayAction): void {
  const binding = (window as unknown as Record<string, ((action: OverlayAction) => Promise<unknown>) | undefined>)[OVERLAY_BINDING];
  void binding?.(action);
}

function quote(value: string | null | undefined): string {
  if (value === null || value === undefined) return '(absent)';
  const flat = value.replace(/\s+/g, ' ');
  return JSON.stringify(flat.length > 160 ? `${flat.slice(0, 157)}...` : flat);
}

function markdown(state: OverlayState, issues: readonly OverlayIssue[]): string {
  const lines = [`### Hydration problems on ${state.url}`, ''];
  for (const issue of issues) {
    lines.push(`- **${issue.code} ${issue.title}**${issue.selector ? ` at \`${issue.selector}\`` : ''}`);
    if (issue.server !== undefined || issue.client !== undefined) lines.push(`  - server: \`${quote(issue.server)}\`, client: \`${quote(issue.client)}\``);
    if (issue.cause) lines.push(`  - likely cause: ${issue.cause.title} (${issue.cause.proven ? 'proven' : `${Math.round(issue.cause.confidence * 100)}%`})`);
    if (issue.source) lines.push(`  - source: \`${issue.source.file}:${issue.source.line}\``);
    if (issue.suggestions[0]) lines.push(`  - fix: ${issue.suggestions[0]}`);
    lines.push(`  - docs: ${issue.docsUrl}`);
  }
  return lines.join('\n');
}

let highlight: HTMLElement | undefined;

function showHighlight(selector: string | undefined): void {
  highlight?.remove();
  highlight = undefined;
  if (!selector) return;
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    return;
  }
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const box = target.getBoundingClientRect();
  highlight = h('div', { 'data-hydration-proof-internal': '' });
  Object.assign(highlight.style, {
    position: 'absolute',
    left: `${box.left + window.scrollX - 3}px`,
    top: `${box.top + window.scrollY - 3}px`,
    width: `${box.width + 6}px`,
    height: `${box.height + 6}px`,
    border: '3px solid #c62a2a',
    borderRadius: '4px',
    background: 'rgb(198 42 42 / 12%)',
    pointerEvents: 'none',
    zIndex: '2147483646',
  });
  document.documentElement.append(highlight);
  setTimeout(() => {
    highlight?.remove();
    highlight = undefined;
  }, 4000);
}

async function copy(text: string, count: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h('textarea', { 'data-hydration-proof-internal': '' }) as HTMLTextAreaElement;
    area.value = text;
    document.documentElement.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  send({ type: 'copied', count });
}

class Overlay {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private state: OverlayState = { status: 'analyzing', url: location.href, issues: [] };
  private open = false;

  constructor() {
    this.host = document.createElement(OVERLAY_TAG);
    this.host.setAttribute('data-hydration-proof-internal', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      this.root.adoptedStyleSheets = [sheet];
    } catch {
      this.root.append(h('style', {}, CSS));
    }
  }

  mount(): void {
    if (!this.host.isConnected) document.documentElement.append(this.host);
    this.render();
  }

  show(state: OverlayState): void {
    this.state = state;
    if (state.status === 'done' && state.issues.some((issue) => issue.severity === 'error')) this.open = true;
    this.mount();
  }

  private render(): void {
    const { state } = this;
    const active = state.issues;
    const errors = active.filter((issue) => issue.severity === 'error').length;
    const warnings = active.filter((issue) => issue.severity === 'warning').length;
    const tone = state.status !== 'done' ? '' : errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok';
    const label =
      state.status === 'analyzing'
        ? 'Hydration: checking…'
        : state.status === 'failed'
          ? 'Hydration check failed'
          : active.length === 0
            ? 'Hydration: no problems'
            : `Hydration: ${[errors ? `${errors} error${errors === 1 ? '' : 's'}` : '', warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '', active.length - errors - warnings ? `${active.length - errors - warnings} info` : ''].filter(Boolean).join(', ')}`;
    const badge = h('button', { class: `badge ${tone}`, type: 'button', 'aria-expanded': String(this.open) }, h('span', { class: 'dot' }), label);
    badge.addEventListener('click', () => {
      this.open = !this.open;
      this.render();
    });
    const children: Node[] = [badge];
    if (this.open) children.push(this.panel());
    this.root.replaceChildren(...children);
  }

  private panel(): HTMLElement {
    const { state } = this;
    const rerun = h('button', { class: 'tool', type: 'button', title: 'Reload the page and check again' }, 'Re-run');
    rerun.addEventListener('click', () => send({ type: 'rerun' }));
    const copyAll = h('button', { class: 'tool', type: 'button' }, 'Copy report');
    copyAll.addEventListener('click', () => void copy(markdown(state, state.issues), state.issues.length));
    const close = h('button', { class: 'tool', type: 'button', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => {
      this.open = false;
      this.render();
    });
    const facts = [state.react, state.outcome, state.durationMs !== undefined ? `${state.durationMs}ms` : ''].filter(Boolean).join(' · ');
    const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Hydration problems' }, h('div', { class: 'head' }, h('b', {}, 'Hydration Proof'), state.issues.length > 0 ? copyAll : null, rerun, close));
    if (facts) panel.append(h('div', { class: 'meta', style: 'padding: 6px 12px 0' }, facts));
    if (state.status === 'failed') panel.append(h('div', { class: 'empty' }, state.error ?? 'The check failed.'));
    else if (state.status === 'analyzing') panel.append(h('div', { class: 'empty' }, 'Checking this page…'));
    else if (state.issues.length === 0) panel.append(h('div', { class: 'empty' }, 'The server HTML and the first client render match.'));
    for (const issue of state.issues) panel.append(this.issue(issue));
    return panel;
  }

  private issue(issue: OverlayIssue): HTMLElement {
    const body = h('div', { class: `issue ${issue.severity}` });
    body.append(h('div', {}, h('span', { class: `code ${issue.severity}` }, issue.code), h('b', {}, issue.title)));
    const where = [issue.selector, issue.component ? `in ${issue.component}` : '', issue.cause ? `${issue.cause.title} (${issue.cause.proven ? 'proven' : `${Math.round(issue.cause.confidence * 100)}%`})` : '']
      .filter(Boolean)
      .join(' · ');
    if (where) body.append(h('div', { class: 'meta' }, where));
    if (issue.server !== undefined || issue.client !== undefined) {
      body.append(h('div', { class: 'values' }, h('span', {}, 'server'), h('span', {}, quote(issue.server)), h('span', {}, 'client'), h('span', {}, quote(issue.client))));
    } else {
      body.append(h('div', { class: 'meta' }, issue.message));
    }
    if (issue.suggestions[0]) body.append(h('p', { class: 'fix' }, `→ ${issue.suggestions[0]}`));
    const actions = h('div', { class: 'actions' });
    if (issue.selector) {
      const show = h('button', { class: 'tool', type: 'button' }, 'Highlight');
      show.addEventListener('click', () => showHighlight(issue.selector));
      actions.append(show);
    }
    if (issue.source) {
      const source = issue.source;
      const open = h('button', { class: 'tool', type: 'button', title: source.file }, `Open ${source.file.split('/').pop()}:${source.line}`);
      open.addEventListener('click', () => send({ type: 'open', file: source.absolute ?? source.file, line: source.line, ...(source.column !== undefined ? { column: source.column } : {}) }));
      actions.append(open);
    }
    const copyOne = h('button', { class: 'tool', type: 'button' }, 'Copy');
    copyOne.addEventListener('click', () => void copy(markdown(this.state, [issue]), 1));
    actions.append(copyOne);
    const docs = h('a', { class: 'tool', href: issue.docsUrl, target: '_blank', rel: 'noreferrer' }, 'Docs');
    actions.append(docs);
    body.append(actions);
    return body;
  }
}

(function install(): void {
  if (window.top !== window) return;
  const record = window as unknown as Record<string, unknown>;
  if (record[OVERLAY_GLOBAL]) return;
  const overlay = new Overlay();
  Object.defineProperty(window, OVERLAY_GLOBAL, {
    value: Object.freeze({ show: (state: OverlayState) => overlay.show(state) }),
    enumerable: false,
    configurable: false,
  });
  const mount = (): void => overlay.mount();
  if (document.readyState === 'complete') mount();
  else window.addEventListener('load', mount, { once: true });
})();
