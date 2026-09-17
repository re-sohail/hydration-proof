import type { SElement, SFragment } from '../shared/protocol.ts';
import { myers } from '../dom/myers.ts';
import { checkNesting, INTERACTIVE_TAGS, updatedAncestorInfo, type AncestorInfo } from '../dom/nesting.ts';
import { rawAttr, tokenizeHtml, type RawElement } from '../dom/tokenize.ts';
import { getAttr, indexTree, isElement, walk, type TreeIndex } from '../dom/tree.ts';
import { locate, locator, placed, type Draft } from './draft.ts';

// Stage 1 -> 2: markup the browser had to repair. The raw HTML is read the way
// React wrote it; the parsed tree is what the browser built from it.

function preorder(root: RawElement): RawElement[] {
  const out: RawElement[] = [];
  const visit = (element: RawElement): void => {
    for (const child of element.children) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

function parsedPreorder(tree: SFragment): SElement[] {
  const out: SElement[] = [];
  walk(tree, (node) => {
    if (isElement(node)) out.push(node);
  });
  return out;
}

function isDescendant(index: TreeIndex, node: number, ancestor: number): boolean {
  let current = index.get(node)?.parent;
  while (current) {
    if (current.id === ancestor) return true;
    current = index.get(current.id)?.parent;
  }
  return false;
}

function label(element: RawElement): string {
  const id = rawAttr(element, 'id');
  return `<${element.tag}${id ? ` id="${id}"` : ''}>`;
}

function validate(root: RawElement): ReturnType<typeof checkNesting<RawElement>>[] {
  const violations: NonNullable<ReturnType<typeof checkNesting<RawElement>>>[] = [];
  const visit = (element: RawElement, info: AncestorInfo<RawElement>): void => {
    for (const child of element.children) {
      if (child.foreign) continue;
      const violation = checkNesting(child.tag, info, child);
      if (violation) violations.push(violation);
      visit(child, updatedAncestorInfo(info, child.tag, child));
    }
  };
  visit(root, updatedAncestorInfo<RawElement>(null, '#document', root));
  return violations;
}

export function analyzeMarkup(html: string, parsed: SFragment): Draft[] {
  const raw = tokenizeHtml(html);
  const violations = validate(raw);
  if (violations.length === 0) return [];

  const rawList = preorder(raw);
  const parsedList = parsedPreorder(parsed);
  const mapping = new Map<RawElement, SElement>();
  for (const edit of myers(rawList, parsedList, (a, b) => a.tag.toLowerCase() === b.tag.toLowerCase())) {
    if (edit.op === 'equal') mapping.set(rawList[edit.a]!, parsedList[edit.b]!);
  }
  const index = indexTree(parsed);
  const where = locator(index);

  const drafts: Draft[] = [];
  for (const violation of violations) {
    if (!violation) continue;
    const child = mapping.get(violation.child);
    const ancestor = mapping.get(violation.ancestor);
    const repaired =
      child !== undefined && ancestor !== undefined
        ? violation.direct
          ? index.get(child.id)?.parent?.id !== ancestor.id
          : !isDescendant(index, child.id, ancestor.id)
        : true;
    const interactive = violation.childTag === violation.ancestorTag && INTERACTIVE_TAGS.has(violation.childTag);
    const relation = violation.direct ? 'child' : 'descendant';
    const location = locate(where, ancestor?.id ?? child?.id);
    const draft = placed(
      {
        code: interactive ? 'HP3002' : 'HP3001',
        stage: 'parsed',
        severity: repaired ? 'error' : 'warning',
        confidence: repaired ? 0.95 : 0.7,
        message:
          `${label(violation.child)} cannot be a ${relation} of ${label(violation.ancestor)} ` +
          `(line ${violation.child.line}, column ${violation.child.column}).` +
          (repaired ? ' The browser moved it while parsing, so React cannot hydrate this markup.' : ''),
        server: `${label(violation.ancestor)} > ${label(violation.child)}`,
        evidence: [
          {
            kind: 'markup',
            message: repaired
              ? `The browser's parser repaired the tree: ${label(violation.child)} is no longer inside ${label(violation.ancestor)}.`
              : `Invalid per the HTML specification; this browser kept the nesting.`,
          },
        ],
        key: `${violation.ancestorTag}>${violation.childTag}:${violation.child.line}`,
      },
      location,
    );
    // The finding explains differences at the ancestor, the moved child and
    // the ancestor's parent (where the browser put the moved nodes).
    const parentId = ancestor ? index.get(ancestor.id)?.parent?.id : undefined;
    const related = [location?.anchor, locate(where, child?.id)?.anchor, parentId !== undefined ? locate(where, parentId)?.selector : undefined]
      .filter((value): value is string => !!value);
    if (related.length > 0) draft.related = related;
    if (child) {
      const childId = getAttr(child, 'id');
      if (childId) draft.evidence.push({ kind: 'note', message: `Nested element: #${childId}` });
    }
    drafts.push(draft);
  }
  return drafts;
}
