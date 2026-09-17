import { isAuditedAttribute, normalizeReactText } from '../shared/attr-map.ts';
import type { CommitInfo, MutationBatch, SElement, SNode, Snapshot } from '../shared/protocol.ts';
import type { IssueCode } from '../issues/registry.ts';
import type { Evidence } from '../report/model.ts';
import { diffTrees, type DomChange } from '../dom/diff.ts';
import { normalizeTree, sameClassList, sameStyle, type NormalizeOptions } from '../dom/normalize.ts';
import { rewind } from '../dom/rewind.ts';
import { getAttr, indexTree, isElement, isText, outline, textContent, walk, type TreeIndex } from '../dom/tree.ts';
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
  const base = { stage: 'hydration' as const, commit: commit.seq, evidence: [...context], ...(component ? { component } : {}) };

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

function auditElement(post: SElement, pre: SElement, event: HydrationEvent, report: boolean): Draft[] {
  const client = post.client;
  if (!client || client.opaque !== undefined) return [];
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
  const emit = (code: IssueCode, draft: Omit<Draft, 'code' | 'stage' | 'evidence' | 'commit'>): void => {
    drafts.push(placed({ ...base, ...draft, code: suppressed ? 'HP6001' : code }, location));
  };

  const skipped = new Set(client.skipped ?? []);
  for (const [name, expected] of Object.entries(client.attrs)) {
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

    walk(postTree, (node) => {
      if (!isElement(node) || audited.has(node.id)) return;
      const preNode = pre.get(node.id)?.node;
      if (!isElement(preNode) || !node.client) return;
      audited.add(node.id);
      drafts.push(...auditElement(node, preNode, event, input.reportUnusedSuppression));
    });
  }
  return { drafts, events };
}
