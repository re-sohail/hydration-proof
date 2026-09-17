import type { IssueCode, Severity } from '../issues/registry.ts';
import type { Evidence, Stage } from '../report/model.ts';
import { cssSelector, domPath, getAttr, idCounts, isElement, type TreeIndex } from '../dom/tree.ts';

/** An issue before fingerprinting, merging and ignore rules. */
export interface Draft {
  code: IssueCode;
  stage: Stage;
  message: string;
  severity?: Severity;
  confidence: number;
  selector?: string;
  domPath?: string[];
  /** Selector of the nearest element with a unique id (used for merging). */
  anchor?: string;
  attribute?: string;
  server?: string | null;
  client?: string | null;
  component?: string;
  componentStack?: string;
  evidence: Evidence[];
  suppressed?: boolean;
  commit?: number;
  /** Fingerprint discriminator for issues without a selector. */
  key?: string;
  /** Anchors of other elements this finding explains (used for merging). */
  related?: string[];
  /** Anchors of elements inside an inserted or removed subtree. */
  nodeAnchors?: string[];
}

export interface Locator {
  index: TreeIndex;
  counts: Map<string, number>;
}

export function locator(index: TreeIndex): Locator {
  return { index, counts: idCounts(index) };
}

export interface Location {
  selector: string;
  domPath: string[];
  anchor: string;
}

export function locate(where: Locator, id: number | undefined): Location | undefined {
  if (id === undefined || !where.index.has(id)) return undefined;
  const selector = cssSelector(where.index, id, where.counts);
  let anchor = selector;
  let current = where.index.get(id);
  while (current) {
    if (isElement(current.node)) {
      const elId = getAttr(current.node, 'id');
      if (elId && where.counts.get(elId) === 1) {
        anchor = `#${elId}`;
        break;
      }
    }
    current = current.parent ? where.index.get(current.parent.id) : undefined;
  }
  return { selector, domPath: domPath(where.index, id), anchor };
}

export function placed(draft: Omit<Draft, 'selector' | 'domPath' | 'anchor'>, location: Location | undefined): Draft {
  return location ? { ...draft, selector: location.selector, domPath: location.domPath, anchor: location.anchor } : draft;
}

export function clip(value: string | null | undefined, max = 300): string | null | undefined {
  if (value === null || value === undefined) return value;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function describeValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return '(absent)';
  const clipped = clip(value, 80) ?? '';
  return JSON.stringify(clipped);
}
