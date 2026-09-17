import type { MutationBatch, SFragment } from '../shared/protocol.ts';
import { diffTrees, type DomChange } from '../dom/diff.ts';
import { normalizeTree, sameClassList, sameStyle, type NormalizeOptions } from '../dom/normalize.ts';
import { rewind } from '../dom/rewind.ts';
import { getAttr, indexTree, isElement, isText, outline, walk, type TreeIndex } from '../dom/tree.ts';
import { describeValue, locate, locator, placed, type Draft } from './draft.ts';

// Stage 2 -> 3: what changed between the browser parsing the server HTML and
// React starting to hydrate. React's own streaming moves are undone first, so
// whatever remains was done by other scripts or browser extensions.

const EXTENSION_ATTRIBUTE =
  /^(?:data-(?:new-gr-c-s-check-loaded|gr-ext-installed|gr-c-s-loaded|lt-installed|lastpass|dashlane|1p|bitwarden|darkreader|ms-editor|wxt)|cz-shortcut-listen|bis_|__processed_|data-gramm|spellcheck-extension)/i;
const HEAD_RESOURCE_TAGS = new Set(['link', 'script', 'style', 'meta', 'noscript', 'title', 'base']);

export interface ExternalInput {
  parsed: SFragment;
  /** Pre-hydration tree of the first hydration commit (un-normalized). */
  preHydration: SFragment;
  /** Batches that React's streaming runtime produced before that commit. */
  streamBatches: MutationBatch[];
  normalize: NormalizeOptions;
  /** Ids (live page) of elements React owns. */
  reactOwned: Set<number>;
  /** The HTML was still streaming when React hydrated. */
  documentLoading: boolean;
  /** Ids (live page) of React root containers. */
  containers: Set<number>;
}

function insideRoot(index: TreeIndex, id: number | undefined, containers: Set<number>): boolean {
  let current = id === undefined ? undefined : index.get(id);
  while (current) {
    if (containers.has(current.node.id)) return true;
    current = current.parent ? index.get(current.parent.id) : undefined;
  }
  return false;
}

/** Nodes at the end of <html>/<body> that the parser had not reached yet. */
function notYetParsed(parsed: SFragment): Set<number> {
  const trailing = new Set<number>();
  walk(parsed, (node) => {
    if (!isElement(node) || (node.tag !== 'body' && node.tag !== 'html')) return;
    for (const child of node.children) trailing.add(child.id);
  });
  return trailing;
}

function inHead(index: TreeIndex, id: number | undefined): boolean {
  let current = id === undefined ? undefined : index.get(id);
  while (current) {
    if (isElement(current.node) && current.node.tag === 'head') return true;
    current = current.parent ? index.get(current.parent.id) : undefined;
  }
  return false;
}

function sameAttribute(name: string, from: string | null, to: string | null): boolean {
  const lower = name.toLowerCase();
  if (lower === 'class') return sameClassList(from, to);
  if (lower === 'style') return sameStyle(from, to);
  return from === to;
}

export function analyzeExternal(input: ExternalInput): Draft[] {
  const beforeStream = rewind(input.preHydration, input.streamBatches).tree;
  const parsed = normalizeTree(input.parsed, input.normalize).tree;
  const live = normalizeTree(beforeStream, input.normalize).tree;
  const liveIndex = indexTree(live);
  const where = locator(liveIndex);
  const changes = diffTrees(parsed, live, { identity: false, sameAttribute });
  const topLevel = input.documentLoading ? notYetParsed(parsed) : new Set<number>();
  // A trailing run of removals directly under <html>/<body> is content the
  // streaming parser had not reached when React started hydrating.
  const pendingTail = new Set<DomChange>();
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i]!;
    if (change.kind !== 'remove' || !change.before || !topLevel.has(change.before.id)) break;
    pendingTail.add(change);
  }

  const drafts: Draft[] = [];
  for (const change of changes) {
    if (pendingTail.has(change)) continue;
    const element = change.afterElement;
    const inHeadElement = inHead(liveIndex, element);
    const owned = element !== undefined && input.reactOwned.has(element);
    const target = liveIndex.get(element ?? -1)?.node;
    const parentOfInsert = change.kind === 'insert' && element !== undefined ? liveIndex.get(element)?.parent : undefined;
    const host = parentOfInsert ?? target;
    const onRoot = isElement(host) && (host.tag === 'html' || host.tag === 'body');
    const hydrated = insideRoot(liveIndex, element, input.containers);

    if ((change.kind === 'insert' || change.kind === 'remove') && inHeadElement) {
      const node = change.after ?? change.before;
      if (isElement(node) && HEAD_RESOURCE_TAGS.has(node.tag)) continue; // loaders, preloads, style injection
    }

    let extension = false;
    if (change.kind === 'attribute' && change.attribute && EXTENSION_ATTRIBUTE.test(change.attribute)) extension = true;
    if (change.kind === 'insert' && isElement(change.after) && change.after.tag.includes('-') && onRoot) extension = true;
    if (change.kind === 'insert' && isElement(change.after) && getAttr(change.after, 'data-hydration-proof-internal') !== null) continue;

    let message: string;
    switch (change.kind) {
      case 'text':
        message = `Text changed before hydration: ${describeValue(change.from)} became ${describeValue(change.to)}.`;
        break;
      case 'attribute':
        message = `Attribute ${change.attribute} changed before hydration: ${describeValue(change.from)} became ${describeValue(change.to)}.`;
        break;
      case 'insert':
        message = `${change.after ? outline(change.after, 80) : 'A node'} was inserted before hydration.`;
        break;
      case 'remove':
        message = `${change.before ? outline(change.before, 80) : 'A node'} was removed before hydration.`;
        break;
      default:
        message = `The DOM changed before hydration (${change.kind}).`;
    }

    // React ignores text and attribute differences on an element marked with
    // suppressHydrationWarning (the next-themes pattern).
    const suppressed =
      isElement(target) && target.client?.suppress === true && (change.kind === 'attribute' || change.kind === 'text');
    // Outside React's roots a change cannot break hydration; keep it for context.
    const severity = extension || suppressed || !hydrated ? 'info' : owned || (!onRoot && !inHeadElement) ? 'error' : 'warning';
    const draft = placed(
      {
        code: extension ? 'HP4002' : suppressed ? 'HP6001' : 'HP4001',
        ...(suppressed ? { suppressed: true } : {}),
        stage: 'pre-hydration',
        severity,
        confidence: extension ? 0.8 : 0.85,
        message,
        evidence: [{ kind: 'mutation', message: 'Found by comparing the parsed server HTML with the DOM right before React hydrated it.' }],
        server: change.kind === 'insert' ? null : (change.from ?? (change.before ? outline(change.before) : null)),
        client: change.kind === 'remove' ? null : (change.to ?? (change.after ? outline(change.after) : null)),
      },
      locate(where, element),
    );
    if (change.attribute) draft.attribute = change.attribute;
    if (isText(change.after) && change.kind === 'insert' && change.after.text.trim() === '') continue;
    drafts.push(draft);
  }
  return drafts;
}
