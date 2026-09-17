import type { BatchPhase, MutationBatch, MutationEntry, SNode } from '../shared/protocol.ts';
import { closedShadowRoots, OWN_NODE_ATTRIBUTE, serializeNode } from './serialize.ts';
import { defineProperty, nativeAttachShadow, NativeMutationObserver, now } from './env.ts';
import { idOf, knownId } from './ids.ts';
import { describeNode, isToolingNode } from './selector.ts';

const OBSERVE: MutationObserverInit = {
  childList: true,
  attributes: true,
  characterData: true,
  subtree: true,
  attributeOldValue: true,
  characterDataOldValue: true,
};

/** Phases whose batches keep every entry, so the engine can rewind them. */
const FULL_PHASES: ReadonlySet<BatchPhase> = new Set(['react-stream', 'hydration-commit']);

// React's streaming runtime ($RC, $RS, $RX, $RV) moves content out of hidden
// `S:`/`P:`/`B:` holders and flips Suspense markers from `$?`. React 18 defines
// these as global function declarations, so they cannot be wrapped; the
// mutations they leave behind are distinctive enough to recognise instead.
const STREAM_HOLDER_ID = /(?:^|:)[SPB]:\d/;

function isStreamHolder(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  const id = el.id;
  if (!id || !STREAM_HOLDER_ID.test(id)) return false;
  return el.localName === 'template' || el.hasAttribute('hidden') || el.localName === 'svg' ||
    el.localName === 'math' || el.localName === 'table';
}

function isStreamRecord(record: MutationRecord): boolean {
  if (record.type === 'characterData') {
    return record.target.nodeType === Node.COMMENT_NODE && (record.oldValue === '$?' || record.oldValue === '$~');
  }
  if (record.type === 'childList') {
    for (const node of Array.from(record.removedNodes)) if (isStreamHolder(node)) return true;
  }
  return false;
}

function isOwn(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute(OWN_NODE_ATTRIBUTE);
}

export interface MutationLogOptions {
  maxEntriesPerBatch: number;
  /** Phase to use for records delivered to the observer callback. */
  ambientPhase(): BatchPhase;
  onBatch(batch: MutationBatch): void;
  onDropped(entries: number): void;
}

export class MutationLog {
  private readonly options: MutationLogOptions;
  private readonly observer: MutationObserver;
  private seq = 0;

  constructor(options: MutationLogOptions) {
    this.options = options;
    this.observer = new NativeMutationObserver((records) => {
      this.process(records, this.options.ambientPhase());
    });
  }

  start(): void {
    this.observer.observe(document, OBSERVE);
    this.patchAttachShadow();
  }

  /** Take pending records synchronously and log them under `phase`. */
  flush(phase: BatchPhase, commit?: number): MutationBatch | null {
    return this.process(this.observer.takeRecords(), phase, commit);
  }

  private patchAttachShadow(): void {
    const observer = this.observer;
    const patched = function attachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
      const root = nativeAttachShadow.call(this, init);
      if (init.mode === 'closed') closedShadowRoots.set(this, root);
      if (!isToolingNode(this)) observer.observe(root, OBSERVE);
      return root;
    };
    defineProperty(Element.prototype, 'attachShadow', {
      value: patched,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  private process(records: MutationRecord[], phase: BatchPhase, commit?: number): MutationBatch | null {
    const relevant = records.filter((record) => !isOwn(record.target));
    if (relevant.length === 0) return null;

    let effectivePhase = phase;
    if (phase === 'loading' || phase === 'pre-hydration' || phase === 'async') {
      if (relevant.some(isStreamRecord)) effectivePhase = 'react-stream';
    }

    const batch: MutationBatch = { seq: ++this.seq, phase: effectivePhase, time: now() };
    if (commit !== undefined) batch.commit = commit;

    if (FULL_PHASES.has(effectivePhase)) {
      const entries: MutationEntry[] = [];
      let dropped = 0;
      for (const record of relevant) {
        if (entries.length >= this.options.maxEntriesPerBatch) {
          dropped++;
          continue;
        }
        entries.push(toEntry(record));
      }
      batch.entries = entries;
      if (dropped > 0) this.options.onDropped(dropped);
    } else {
      batch.summary = summarize(relevant);
    }
    this.options.onBatch(batch);
    return batch;
  }
}

function toEntry(record: MutationRecord): MutationEntry {
  const target = idOf(record.target);
  switch (record.type) {
    case 'attributes': {
      const entry: MutationEntry = { t: 'attr', target, name: record.attributeName ?? '', old: record.oldValue };
      if (record.attributeNamespace) entry.ns = record.attributeNamespace;
      return entry;
    }
    case 'characterData':
      return { t: 'text', target, old: record.oldValue ?? '' };
    default: {
      const removed: SNode[] = [];
      for (const node of Array.from(record.removedNodes)) {
        const serialized = serializeNode(node);
        if (serialized !== null) removed.push(serialized);
      }
      return {
        t: 'child',
        target,
        prev: knownId(record.previousSibling),
        next: knownId(record.nextSibling),
        added: Array.from(record.addedNodes, (node) => idOf(node)),
        removed,
      };
    }
  }
}

function summarize(records: MutationRecord[]): NonNullable<MutationBatch['summary']> {
  const summary = { attrs: 0, texts: 0, added: 0, removed: 0, targets: [] as string[] };
  for (const record of records) {
    if (record.type === 'attributes') summary.attrs++;
    else if (record.type === 'characterData') summary.texts++;
    else {
      summary.added += record.addedNodes.length;
      summary.removed += record.removedNodes.length;
    }
    if (summary.targets.length < 5 && record.type !== 'childList') {
      const label = describeNode(record.target);
      if (!summary.targets.includes(label)) summary.targets.push(label);
    }
  }
  return summary;
}
