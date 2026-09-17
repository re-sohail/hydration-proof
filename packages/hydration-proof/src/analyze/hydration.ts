import { isAuditedAttribute, normalizeReactText } from '../shared/attr-map.ts';
import type { CommitInfo, MutationBatch, SElement, SFragment, SNode, Snapshot } from '../shared/protocol.ts';
import type { IssueCode } from '../issues/registry.ts';
import type { Evidence } from '../report/model.ts';
import { diffTrees, type DomChange } from '../dom/diff.ts';
import { normalizeTree, sameClassList, sameStyle, type NormalizeOptions } from '../dom/normalize.ts';
import { rewind } from '../dom/rewind.ts';
import { getAttr, indexTree, isElement, isText, outline, textContent, toHtml, walk, type TreeIndex } from '../dom/tree.ts';
import { FORM_STATE_NOTE } from '../diagnose/index.ts';
import { describeValue, locate, locator, placed, type Draft, type Locator } from './draft.ts';

// Analyse each commit that hydrated a root or a Suspense boundary:
//  1. rebuild the DOM as it was right before the commit,
//  2. diff it against the snapshot taken inside the commit (identity-aware),
//  3. audit reused elements against the props React will render.

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autoplay', 'controls', 'default', 'defer', 'disabled', 'disablepictureinpicture',
  'disableremoteplayback', 'formnovalidate', 'hidden', 'loop', 'nomodule', 'novalidate', 'open', 'playsinline',
  'readonly', 'required', 'reversed', 'scoped', 'seamless', 'itemscope',
]);

const HEAD_RESOURCE_TAGS = new Set(['link', 'script', 'style', 'meta', 'title', 'base']);

export interface HydrationInput {
  commits: CommitInfo[];
  batches: MutationBatch[];
  snapshots: Snapshot[];
  /** Node ids of the root containers React mounted into. */
  containers: Set<number>;
  normalize: NormalizeOptions;
  /** Report suppressHydrationWarning with nothing to suppress. */
  reportUnusedSuppression: boolean;
  /** Compare reused elements with the props React renders. */
  propsAudit: boolean;
  /**
   * Form control values as the server sent them, keyed by `#id` or `[name]`.
   * React applies `value`/`checked` in the mutation phase, which can be
   * observed before the commit that would let the rewind undo it, so the
   * parsed server HTML is the only race-free source for them.
   */
  serverForms?: Map<string, string>;
}

export interface HydrationEvent {
  commit: CommitInfo;
  pre: TreeIndex;
  post: TreeIndex;
  preLocator: Locator;
  postLocator: Locator;
  /** The whole pre-hydration tree (first hydration commit only is used for stage-2 comparison). */
  preTree: ReturnType<typeof rewind>['tree'];
  unresolved: number;
}

export interface HydrationResult {
  drafts: Draft[];
  events: HydrationEvent[];
}

function attributeCode(name: string, server: string | null, client: string | null): IssueCode {
  const lower = name.toLowerCase();
  if (lower === 'class') return 'HP1004';
  if (lower === 'style') return 'HP1003';
  if (server !== null && client === null) return 'HP1005';
  if (server === null && client !== null) return 'HP1006';
  return 'HP1002';
}

function sameAttribute(name: string, from: string | null, to: string | null): boolean {
  const lower = name.toLowerCase();
  if (lower === 'class') return sameClassList(from, to);
  if (lower === 'style') return sameStyle(from, to);
  if (BOOLEAN_ATTRIBUTES.has(lower)) return (from === null) === (to === null);
  return from === to;
}

function whitespaceOnly(a: string, b: string): boolean {
  return a !== b && a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
}

function isWhitespaceText(node: SNode | undefined): boolean {
  return isText(node) && node.text.trim() === '';
}

function inHead(index: TreeIndex, id: number | undefined): boolean {
  let current = id === undefined ? undefined : index.get(id);
  while (current) {
    if (isElement(current.node) && current.node.tag === 'head') return true;
    current = current.parent ? index.get(current.parent.id) : undefined;
  }
  return false;
}

function ownerOf(index: TreeIndex, id: number | undefined): string | undefined {
  let current = id === undefined ? undefined : index.get(id);
  while (current) {
    if (isElement(current.node) && current.node.owner) return current.node.owner;
    current = current.parent ? index.get(current.parent.id) : undefined;
  }
  return undefined;
}

function elementNode(index: TreeIndex, id: number | undefined): SElement | undefined {
  const node = id === undefined ? undefined : index.get(id)?.node;
  return isElement(node) ? node : undefined;
}

/** The element as React wants it: DOM attributes replaced by the client view. */
function clientVersion(el: SElement): SElement {
  const client = el.client;
  if (!client) return el;
  const attrs = new Map(el.attrs);
  for (const [name, value] of Object.entries(client.attrs)) {
    if (value === null) attrs.delete(name);
    else attrs.set(name, value);
  }
  if (client.style !== undefined) attrs.set('style', client.style);
  const children = client.text !== undefined ? [{ k: 3 as const, id: -1, text: client.text }] : el.children;
  return { ...el, attrs: [...attrs.entries()], children };
}

function excerpt(server: SNode | undefined, client: SNode | undefined): { server?: string; client?: string } {
  const out: { server?: string; client?: string } = {};
  if (server) out.server = toHtml(server, { maxDepth: 3, maxLength: 800 });
  if (client) out.client = toHtml(client, { maxDepth: 3, maxLength: 800 });
  return out;
}

/** The nearest ancestor (not html/body) marked with suppressHydrationWarning. */
function suppressingAncestor(index: TreeIndex, id: number | undefined): SElement | undefined {
  let current = id === undefined ? undefined : index.get(id);
  current = current?.parent ? index.get(current.parent.id) : undefined;
  while (current) {
    const node = current.node;
    if (isElement(node)) {
      if (node.tag === 'html' || node.tag === 'body') return undefined;
      if (node.client?.suppress) return node;
    }
    current = current.parent ? index.get(current.parent.id) : undefined;
  }
  return undefined;
}

function isSuppressed(index: TreeIndex, elementId: number | undefined): boolean {
  const located = elementId === undefined ? undefined : index.get(elementId);
  return isElement(located?.node) && located.node.client?.suppress === true;
}

function replacementScope(change: DomChange, containers: Set<number>, post: TreeIndex): 'root' | 'branch' {
  const parentId = change.after ? post.get(change.after.id)?.parent?.id : undefined;
  if (parentId === undefined) return 'root';
  if (containers.has(parentId)) return 'root';
  const parent = post.get(parentId)?.node;
  if (parent && (parent.k === 9 || (isElement(parent) && (parent.tag === 'html' || parent.tag === 'body')))) return 'root';
  return 'branch';
}

/** Ids inside an inserted/removed subtree, so merging can match them. */
function withNodeAnchors(node: SNode | undefined, draft: Draft): Draft {
  if (!node) return draft;
  const anchors: string[] = [];
  walk(node, (inner) => {
    if (!isElement(inner)) return;
    const id = getAttr(inner, 'id');
    if (id) anchors.push(`#${id}`);
  });
  if (anchors.length > 0) draft.nodeAnchors = anchors;
  return draft;
}

function classifyChange(
  change: DomChange,
  event: HydrationEvent,
  context: Evidence[],
): Draft | undefined {
  const { postLocator, pre, post, commit } = event;
  const component = ownerOf(post, change.afterElement);
  const serverElement = elementNode(pre, change.beforeElement) ?? (isElement(change.before) ? change.before : undefined);
  const clientElement = elementNode(post, change.afterElement) ?? (isElement(change.after) ? change.after : undefined);
  const evidence = [...context];
  const suppressor = suppressingAncestor(post, change.afterElement);
  if (suppressor) {
    evidence.push({
      kind: 'note',
      message: `<${suppressor.tag}> has suppressHydrationWarning, but it only covers that element's own text and attributes, not this descendant.`,
    });
  }
  const base = {
    stage: 'hydration' as const,
    commit: commit.seq,
    evidence,
    excerpt: excerpt(change.kind === 'insert' ? undefined : (serverElement ?? change.before), change.kind === 'remove' ? undefined : (clientElement ?? change.after)),
    ...(component ? { component } : {}),
  };
  // Scripts are not page content: React never runs scripts it renders on the
  // client, and frameworks add or drop them when a document is re-rendered.
  const node = change.kind === 'insert' ? change.after : change.kind === 'remove' ? change.before : undefined;
  if (isElement(node) && node.tag === 'script') return undefined;
  // suppressHydrationWarning covers an element's own content: a structural
  // change counts when it happens inside a suppressed element (or replaces its tag).
  const container = change.kind === 'insert' ? post.get(change.afterElement ?? -1)?.parent?.id : change.kind === 'remove' ? change.afterElement : change.afterElement;
  const suppressedHere =
    change.kind === 'tag'
      ? isSuppressed(post, change.afterElement) || clientElement?.client?.suppress === true
      : change.kind === 'insert' || change.kind === 'remove'
        ? isSuppressed(post, container)
        : false;
  if (suppressedHere) {
    return placed(
      {
        ...base,
        code: 'HP6002',
        confidence: 0.9,
        suppressed: true,
        message: `suppressHydrationWarning is set here, but the elements inside differ between server and client, so React still re-renders them.`,
      },
      locate(postLocator, change.afterElement),
    );
  }

  switch (change.kind) {
    case 'text': {
      const from = change.from ?? '';
      const to = change.to ?? '';
      const code: IssueCode = whitespaceOnly(from, to) ? 'HP1015' : 'HP1001';
      return placed(
        {
          ...base,
          code,
          confidence: 0.95,
          message: `Server rendered ${describeValue(from)}, the client rendered ${describeValue(to)}.`,
          server: from,
          client: to,
        },
        locate(postLocator, change.afterElement),
      );
    }
    case 'attribute': {
      const name = change.attribute ?? '';
      const code = attributeCode(name, change.from ?? null, change.to ?? null);
      return placed(
        {
          ...base,
          code,
          confidence: 0.9,
          attribute: name,
          message: `Attribute ${name}: server ${describeValue(change.from)}, client ${describeValue(change.to)}.`,
          server: change.from ?? null,
          client: change.to ?? null,
        },
        locate(postLocator, change.afterElement),
      );
    }
    case 'tag':
      return placed(
        {
          ...base,
          code: 'HP1007',
          confidence: 0.95,
          message: `The server rendered <${change.from}>, the client rendered <${change.to}>.`,
          server: `<${change.from}>`,
          client: `<${change.to}>`,
        },
        locate(postLocator, change.afterElement),
      );
    case 'insert': {
      if (inHead(post, change.afterElement) && isElement(change.after) && HEAD_RESOURCE_TAGS.has(change.after.tag)) return undefined;
      const whitespace = isWhitespaceText(change.after);
      return withNodeAnchors(change.after, placed(
        {
          ...base,
          code: whitespace ? 'HP1015' : 'HP1009',
          confidence: whitespace ? 0.9 : 0.85,
          message: whitespace
            ? 'The client renders whitespace that is missing from the server HTML.'
            : `The client renders ${change.after ? outline(change.after, 80) : 'a node'} that the server HTML does not contain.`,
          server: null,
          client: change.after ? outline(change.after) : null,
        },
        locate(postLocator, change.afterElement),
      ));
    }
    case 'remove': {
      if (isElement(change.before) && HEAD_RESOURCE_TAGS.has(change.before.tag) && inHead(pre, change.beforeElement)) return undefined;
      const whitespace = isWhitespaceText(change.before);
      return withNodeAnchors(change.before, placed(
        {
          ...base,
          code: whitespace ? 'HP1015' : 'HP1008',
          confidence: whitespace ? 0.9 : 0.85,
          message: whitespace
            ? 'The server HTML has whitespace the client does not render.'
            : `The server HTML contains ${change.before ? outline(change.before, 80) : 'a node'} that the client does not render.`,
          server: change.before ? outline(change.before) : null,
          client: null,
        },
        locate(postLocator, change.afterElement),
      ));
    }
    case 'form':
      return placed(
        {
          ...base,
          code: 'HP1012',
          confidence: 0.7,
          attribute: change.attribute ?? 'value',
          message: `Form ${change.attribute}: server ${describeValue(change.from)}, client ${describeValue(change.to)}.`,
          server: change.from ?? null,
          client: change.to ?? null,
        },
        locate(postLocator, change.afterElement),
      );
    default:
      return undefined;
  }
}

/**
 * The value the server HTML gives a form control. React renders `value` and
 * `checked` as attributes on the server and as properties on the client, and
 * `<select>` marks the chosen `<option>` with `selected`, so each control type
 * has to be read the way the HTML parser would.
 */
export function formKeys(el: SElement): string[] {
  const keys: string[] = [];
  const id = getAttr(el, 'id');
  if (id) keys.push(`#${id}`);
  const name = getAttr(el, 'name');
  if (name) keys.push(`${el.tag}[name=${name}]`);
  return keys;
}

function serverFormValue(
  el: SElement,
  property: 'value' | 'checked',
  post?: SElement,
  serverForms?: Map<string, string>,
): string | undefined {
  // The parsed server HTML first: it cannot have been changed by React.
  if (serverForms && post) {
    for (const key of formKeys(post)) {
      const value = serverForms.get(`${key}|${property}`);
      if (value !== undefined) return value;
    }
  }
  if (property === 'checked') return String(getAttr(el, 'checked') !== null);
  if (el.tag === 'textarea') return textContent(el);
  if (el.tag === 'input') return getAttr(el, 'value') ?? '';
  if (el.tag === 'select') {
    // The browser selects the marked option, or the first one when none is marked.
    const options: SElement[] = [];
    const walk = (node: SNode): void => {
      if (!isElement(node)) return;
      if (node.tag === 'option') options.push(node);
      else for (const child of node.children) walk(child);
    };
    for (const child of el.children) walk(child);
    if (options.length === 0) return undefined;
    const chosen = options.find((option) => getAttr(option, 'selected') !== null) ?? options[0]!;
    return getAttr(chosen, 'value') ?? textContent(chosen);
  }
  return undefined;
}

/**
 * Reads every form control the server rendered, keyed by `#id|property` and
 * `tag[name=…]|property`. Controls without an id or a name are left out: there
 * is no reliable way to pair them with the live element, and a wrong pair would
 * report a mismatch that does not exist.
 */
export function serverFormValues(parsed: SNode | SFragment): Map<string, string> {
  const out = new Map<string, string>();
  walk(parsed, (node) => {
    if (!isElement(node)) return;
    const property = node.tag === 'input' ? (INPUT_CHECKED_TYPES.has((getAttr(node, 'type') ?? 'text').toLowerCase()) ? 'checked' : 'value') : 'value';
    if (node.tag !== 'input' && node.tag !== 'textarea' && node.tag !== 'select') return;
    const value = serverFormValue(node, property);
    if (value === undefined) return;
    for (const key of formKeys(node)) {
      const full = `${key}|${property}`;
      // An ambiguous key is worse than none.
      out.set(full, out.has(full) ? '\u0000ambiguous' : value);
    }
  });
  for (const [key, value] of out) if (value === '\u0000ambiguous') out.delete(key);
  return out;
}

const INPUT_CHECKED_TYPES: ReadonlySet<string> = new Set(['checkbox', 'radio']);

function attributeIgnored(name: string, patterns: NormalizeOptions['ignoreAttributes']): boolean {
  const lower = name.toLowerCase();
  return patterns.some((pattern) => (typeof pattern === 'string' ? pattern.toLowerCase() === lower : pattern.test(lower)));
}

function auditElement(post: SElement, pre: SElement, event: HydrationEvent, report: boolean, normalize: NormalizeOptions, serverForms?: Map<string, string>): Draft[] {
  const client = post.client;
  if (!client || client.opaque !== undefined) return [];
  const ignoredAttribute = (name: string): boolean => attributeIgnored(name, normalize.ignoreAttributes) || attributeIgnored(name, normalize.maskAttributes);
  const drafts: Draft[] = [];
  const suppressed = client.suppress === true;
  const location = locate(event.postLocator, post.id);
  const base = {
    stage: 'hydration' as const,
    commit: event.commit.seq,
    evidence: [] as Evidence[],
    ...(post.owner ? { component: post.owner } : {}),
    ...(suppressed ? { suppressed: true } : {}),
  };
  const views = excerpt(pre, clientVersion(post));
  const emit = (code: IssueCode, draft: Omit<Draft, 'code' | 'stage' | 'evidence' | 'commit'>): void => {
    drafts.push(placed({ ...base, excerpt: views, ...draft, code: suppressed ? 'HP6001' : code }, location));
  };

  const skipped = new Set(client.skipped ?? []);
  for (const [name, expected] of Object.entries(client.attrs)) {
    if (ignoredAttribute(name)) continue;
    const server = getAttr(pre, name);
    if (server !== getAttr(post, name)) continue; // changed during the commit: an effect, not a mismatch
    const equal = BOOLEAN_ATTRIBUTES.has(name.toLowerCase())
      ? (server === null) === (expected === null)
      : name.toLowerCase() === 'class'
        ? sameClassList(server, expected)
        : server === expected;
    if (equal) continue;
    emit(attributeCode(name, server, expected), {
      confidence: 0.9,
      attribute: name,
      server,
      client: expected,
      message: `React renders ${name}=${describeValue(expected)} but the server HTML has ${describeValue(server)}. React does not patch attributes, so the page keeps the server value.`,
    });
  }

  for (const [name, server] of pre.attrs) {
    const lower = name.toLowerCase();
    if (!isAuditedAttribute(lower) || lower in client.attrs || skipped.has(lower) || skipped.has(name)) continue;
    if (ignoredAttribute(lower)) continue;
    if (lower === 'style' && client.style !== undefined) continue;
    if (server !== getAttr(post, name)) continue;
    emit(attributeCode(lower, server, null), {
      confidence: 0.75,
      attribute: lower,
      server,
      client: null,
      message: `The server HTML has ${lower}=${describeValue(server)}, which React does not render on the client.`,
    });
  }

  if (client.style !== undefined && client.domStyle !== undefined && client.style !== client.domStyle) {
    if (getAttr(pre, 'style') === getAttr(post, 'style')) {
      emit('HP1003', {
        confidence: 0.9,
        attribute: 'style',
        server: client.domStyle,
        client: client.style,
        message: `React applies style ${describeValue(client.style)} but the server HTML has ${describeValue(client.domStyle)}.`,
      });
    }
  }

  if (client.form !== undefined && !suppressed) {
    const form = client.form;
    const server = serverFormValue(pre, form.property, post, serverForms);
    // React applies the property, so the live control holds React's value and
    // the difference is silent: the field the user was shown changed.
    if (server !== undefined && server !== form.client) {
      emit('HP1012', {
        confidence: form.dom === form.client ? 0.9 : 0.7,
        attribute: form.property,
        server,
        client: form.client,
        message:
          `The server HTML gives ${describeValue(server)} for this control's ${form.property}, but React renders ` +
          `${describeValue(form.client)}${form.dom === form.client ? ', which replaced it during hydration' : ''}. ` +
          'React reports nothing for form properties.',
      });
    }
  }

  if (client.text !== undefined) {
    const serverText = textContent(pre);
    if (normalizeReactText(serverText) !== client.text && serverText === textContent(post)) {
      emit('HP1001', {
        confidence: 0.9,
        server: serverText,
        client: client.text,
        message: `Server rendered ${describeValue(serverText)}, React renders ${describeValue(client.text)}.`,
      });
    }
  }

  if (client.handlers?.length && !suppressed) {
    const events = client.handlers;
    drafts.push(
      placed(
        {
          ...base,
          code: 'HP5006',
          confidence: 0.7,
          excerpt: views,
          message: `React handles ${events.map((type) => `"${type}"`).join(', ')} on this element, and ${events.length === 1 ? 'so does' : 'so do'} a script listener or an inline on${events[0]} attribute. One action can run twice.`,
          evidence: [{ kind: 'note', message: `Events handled twice: ${events.join(', ')}.` }],
        },
        location,
      ),
    );
  }

  if (client.htmlMatch === false) {
    emit('HP1013', {
      confidence: 0.85,
      message: 'The markup injected with dangerouslySetInnerHTML differs from what the client renders.',
    });
  }

  for (const child of post.children) {
    if (!isText(child) || child.client === undefined || client.text !== undefined) continue;
    const preChild = event.pre.get(child.id)?.node;
    if (!isText(preChild) || preChild.text !== child.text) continue;
    emit('HP1001', {
      confidence: 0.9,
      server: child.text,
      client: child.client,
      message: `Server rendered ${describeValue(child.text)}, React renders ${describeValue(child.client)}.`,
    });
  }

  if (report && suppressed && drafts.length === 0) {
    drafts.push(
      placed(
        {
          ...base,
          code: 'HP6003',
          confidence: 0.6,
          message: 'suppressHydrationWarning is set, but the server and client output are identical.',
        },
        location,
      ),
    );
  }
  return drafts;
}

/** Ids of <form> elements the server rendered with Server Action state (preceded by `<!--F!-->`). */
export function formsWithState(tree: SNode | ReturnType<typeof rewind>['tree']): Set<number> {
  const forms = new Set<number>();
  walk(tree, (node) => {
    const children = 'children' in node ? node.children : undefined;
    if (!children) return;
    children.forEach((child, index) => {
      if (child.k !== 8 || child.text !== 'F!') return;
      const next = children.slice(index + 1).find((sibling) => !(isText(sibling) && sibling.text.trim() === ''));
      if (isElement(next) && next.tag === 'form') forms.add(next.id);
    });
  });
  return forms;
}

function insideAny(index: TreeIndex, id: number | undefined, ancestors: Set<number>): boolean {
  let current = id === undefined ? undefined : index.get(id);
  while (current) {
    if (ancestors.has(current.node.id)) return true;
    current = current.parent ? index.get(current.parent.id) : undefined;
  }
  return false;
}

export function analyzeHydration(input: HydrationInput): HydrationResult {
  const drafts: Draft[] = [];
  const events: HydrationEvent[] = [];
  const audited = new Set<number>();

  for (const commit of input.commits) {
    if (commit.kind === 'update' || commit.snapshot === undefined) continue;
    const snapshot = input.snapshots.find((entry) => entry.seq === commit.snapshot);
    if (!snapshot) continue;
    const batches = input.batches.filter((batch) => batch.phase === 'hydration-commit' && batch.commit === commit.seq);
    const rewound = rewind(snapshot.tree, batches);
    const preTree = normalizeTree(rewound.tree, input.normalize).tree;
    const postTree = normalizeTree(snapshot.tree, input.normalize).tree;
    const pre = indexTree(preTree);
    const post = indexTree(postTree);
    const event: HydrationEvent = {
      commit,
      pre,
      post,
      preLocator: locator(pre),
      postLocator: locator(post),
      preTree: rewound.tree,
      unresolved: rewound.unresolved,
    };
    events.push(event);

    const statefulForms = formsWithState(rewound.tree);
    const firstDraft = drafts.length;
    const changes = diffTrees(preTree, postTree, { identity: true, sameAttribute });
    const replaced = new Map<number, Evidence>();
    changes.forEach((change, position) => {
      if (change.kind !== 'replace') return;
      // React 19 re-creates hoisted <head> children when it re-renders a document root.
      if (inHead(post, change.afterElement)) return;
      const scope = replacementScope(change, input.containers, post);
      const label = change.after && isElement(change.after) ? `<${change.after.tag}>` : 'a branch';
      replaced.set(position, {
        kind: 'dom-change',
        message:
          scope === 'root'
            ? `React discarded the server HTML of the whole root (from ${label}) and rendered it again on the client.`
            : `React discarded the server HTML of ${label} and rendered it again on the client.`,
      });
    });

    const explained = new Set<number>();
    changes.forEach((change, position) => {
      if (change.kind === 'replace') return;
      const inside = change.within !== undefined;
      const recreatedText = change.kind === 'text' && change.before !== undefined && change.after !== undefined && change.before.id !== change.after.id;
      if (!inside && change.kind === 'text' && !recreatedText) {
        // A reused text node changed in the commit: React 18 patches suppressed text.
        if (isSuppressed(post, change.afterElement)) {
          drafts.push(
            placed(
              {
                code: 'HP6001',
                stage: 'hydration',
                commit: commit.seq,
                confidence: 0.9,
                suppressed: true,
                server: change.from ?? null,
                client: change.to ?? null,
                evidence: [],
                message: `Server rendered ${describeValue(change.from)}, the client rendered ${describeValue(change.to)} (suppressHydrationWarning).`,
              },
              locate(event.postLocator, change.afterElement),
            ),
          );
        }
        return;
      }
      if (!inside && (change.kind === 'attribute' || change.kind === 'form')) return; // effects
      if (inside && !replaced.has(change.within!)) return; // inside an ignored <head> replacement
      const context = inside ? [replaced.get(change.within!)!] : [];
      const draft = classifyChange(change, event, context);
      if (!draft) return;
      drafts.push(draft);
      if (inside) explained.add(change.within!);
    });

    // Replacements are one event: report the outermost one only when no
    // concrete difference was found inside any of them.
    const unexplained = explained.size === 0 ? [...replaced].slice(0, 1) : [];
    for (const [position, evidence] of unexplained) {
      const change = changes[position]!;
      const scope = replacementScope(change, input.containers, post);
      const component = ownerOf(post, change.afterElement);
      drafts.push(
        placed(
          {
            code: scope === 'root' ? 'HP1011' : 'HP1010',
            stage: 'hydration',
            commit: commit.seq,
            confidence: 0.8,
            evidence: [evidence],
            message: evidence.message,
            ...(component ? { component } : {}),
          },
          locate(event.postLocator, change.afterElement),
        ),
      );
    }

    if (input.propsAudit) {
      walk(postTree, (node) => {
        if (!isElement(node) || audited.has(node.id)) return;
        const preNode = pre.get(node.id)?.node;
        if (!isElement(preNode) || !node.client) return;
        audited.add(node.id);
        drafts.push(...auditElement(node, preNode, event, input.reportUnusedSuppression, input.normalize, input.serverForms));
      });
    }

    if (statefulForms.size > 0) {
      for (const draft of drafts.slice(firstDraft)) {
        if (insideAny(post, draft.nodeId, statefulForms)) draft.evidence.push({ kind: 'note', message: FORM_STATE_NOTE });
      }
    }
  }
  return { drafts, events };
}
