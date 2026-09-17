import {
  PROTOCOL_VERSION,
  type BatchPhase,
  type CapturedError,
  type CommitInfo,
  type CommitKind,
  type DrainPayload,
  type HydrationStatus,
  type MutationBatch,
  type NodeRect,
  type NodeSource,
  type RendererInfo,
  type RootInfo,
  type RuntimeApi,
  type RuntimeOptions,
  type RuntimeStatus,
  type Snapshot,
  type SnapshotKind,
} from '../shared/protocol.ts';
import { clientViewHooks } from './client-view.ts';
import { NativeMap, now, sourceTextOf } from './env.ts';
import { installErrorCapture, wrapRootCallbacks, type ErrorReport, type ErrorSink } from './errors.ts';
import {
  componentFunctions,
  creationStacks,
  debugSources,
  dehydratedBoundaries,
  fiberOf,
  isBlockingBoundary,
  isRootDehydrated,
  learnSuffixes,
  ownerChain,
  wasRootDehydrated,
  type FiberRoot,
  type ReactRenderer,
} from './fiber.ts';
import { installHook } from './hook.ts';
import { idOf, nodeById } from './ids.ts';
import { inputState, interactionTargets, observePage, prepareInput } from './interactions.ts';
import { installListenerTracking } from './listeners.ts';
import { MutationLog } from './observer.ts';
import { cssPath, isToolingNode } from './selector.ts';
import { serializeRoot, setIgnoreSelectors } from './serialize.ts';

interface RootState {
  info: RootInfo;
  /** Start comments of boundaries still dehydrated (blocking or not). */
  pending: Set<Node>;
  /** The root or a blocking boundary is still dehydrated. */
  hydrating: boolean;
  /** Keep walking the tree on commits: something may still hydrate. */
  tracking: boolean;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function startRuntime(options: RuntimeOptions): RuntimeApi {
  const navigationId = randomId();

  const renderers: RendererInfo[] = [];
  const roots = new NativeMap<FiberRoot, RootState>();
  let commits: CommitInfo[] = [];
  let errors: CapturedError[] = [];
  let batches: MutationBatch[] = [];
  let snapshots: Snapshot[] = [];
  let dropped: NonNullable<DrainPayload['dropped']> = {};

  let hydration: HydrationStatus = 'waiting';
  let activity = 0;
  let commitSeq = 0;
  let errorSeq = 0;
  let snapshotSeq = 0;
  let rootSeq = 0;
  let lastCommit: number | undefined;
  let effectsFlushed = 0;
  const awaitingEffects = new NativeMap<FiberRoot, number>();

  const ambientPhase = (): BatchPhase => {
    if (renderers.length === 0) return 'loading';
    return hydration === 'waiting' ? 'pre-hydration' : 'async';
  };

  const log = new MutationLog({
    maxEntriesPerBatch: options.maxEntriesPerBatch,
    ambientPhase,
    onBatch(batch) {
      batches.push(batch);
      activity++;
    },
    onDropped(count) {
      dropped.entries = (dropped.entries ?? 0) + count;
    },
  });

  const sink: ErrorSink = {
    push(report: ErrorReport) {
      activity++;
      if (errors.length >= options.maxErrors) {
        dropped.errors = (dropped.errors ?? 0) + 1;
        return;
      }
      const entry: CapturedError = { seq: ++errorSeq, time: now(), ...report };
      if (entry.commit === undefined && lastCommit !== undefined) entry.commit = lastCommit;
      errors.push(entry);
    },
  };

  function takeSnapshot(kind: SnapshotKind, commit?: number): number {
    const tree = serializeRoot(document, options.captureClientView ? clientViewHooks : {});
    const snapshot: Snapshot = { seq: ++snapshotSeq, kind, time: now(), root: tree.id, tree };
    if (commit !== undefined) snapshot.commit = commit;
    snapshots.push(snapshot);
    return snapshot.seq;
  }

  function updateHydrationStatus(): void {
    let hydrate = 0;
    let hydrating = 0;
    let appRoots = 0;
    for (const state of roots.values()) {
      if (state.info.tooling) continue;
      appRoots++;
      if (state.info.mode !== 'hydrate') continue;
      hydrate++;
      if (state.hydrating) hydrating++;
    }
    if (hydrate === 0) hydration = appRoots > 0 ? 'client-only' : 'waiting';
    else hydration = hydrating > 0 ? 'hydrating' : 'done';
  }

  function registerRoot(rendererId: number, root: FiberRoot): RootState {
    const container = root.containerInfo as Node;
    learnSuffixes(container);
    const id = ++rootSeq;
    wrapRootCallbacks(root, sink, id);
    const mode = wasRootDehydrated(root) || isRootDehydrated(root) ? 'hydrate' : 'client';
    const info: RootInfo = {
      id,
      rendererId,
      container: idOf(container),
      containerSelector: container.nodeType === Node.DOCUMENT_NODE ? '#document' : cssPath(container as Element),
      mode,
      pendingBoundaries: 0,
    };
    if (typeof root.identifierPrefix === 'string' && root.identifierPrefix !== '') {
      info.identifierPrefix = root.identifierPrefix;
    }
    if (isToolingNode(container)) info.tooling = true;
    const hydrating = mode === 'hydrate' && !info.tooling;
    const state: RootState = { info, pending: new Set(), hydrating, tracking: hydrating };
    roots.set(root, state);
    return state;
  }

  function onInject(id: number, renderer: ReactRenderer): void {
    log.flush(ambientPhase());
    renderers.push({
      id,
      version: renderer.reconcilerVersion ?? renderer.version ?? '',
      packageName: renderer.rendererPackageName ?? '',
      bundleType: typeof renderer.bundleType === 'number' ? renderer.bundleType : -1,
      time: now(),
    });
    activity++;
  }

  function onCommit(rendererId: number, root: FiberRoot, didError: boolean): void {
    const state = roots.get(root) ?? registerRoot(rendererId, root);
    if (state.info.tooling) {
      // Dev overlays render on their own; keep their DOM work out of the log.
      log.flush(ambientPhase());
      return;
    }
    const wasDehydrated = wasRootDehydrated(root);

    let kind: CommitKind = 'update';
    const pendingBefore = state.pending.size + (wasDehydrated ? 1 : 0);
    let pendingAfter = state.info.pendingBoundaries;
    if (state.tracking) {
      const next = dehydratedBoundaries(root);
      if (wasDehydrated) {
        kind = 'hydration';
      } else {
        for (const node of state.pending) {
          if (!next.has(node)) {
            kind = 'boundary-hydration';
            break;
          }
        }
      }
      state.pending = next;
      let blocking = 0;
      for (const node of next) if (isBlockingBoundary(node)) blocking++;
      pendingAfter = blocking + (isRootDehydrated(root) ? 1 : 0);
      state.info.pendingBoundaries = pendingAfter;
      if (pendingAfter === 0 && state.hydrating) {
        state.hydrating = false;
        state.info.hydratedAt = now();
      }
      state.tracking = next.size > 0 || isRootDehydrated(root);
    }

    const seq = ++commitSeq;
    lastCommit = seq;
    log.flush(kind === 'update' ? 'commit' : 'hydration-commit', seq);

    const commit: CommitInfo = {
      seq,
      rootId: state.info.id,
      kind,
      time: now(),
      didError,
      pendingBefore,
      pendingAfter,
      readyState: document.readyState,
    };
    if (kind !== 'update') {
      commit.snapshot = takeSnapshot('hydration', seq);
      awaitingEffects.set(root, seq);
    }
    commits.push(commit);
    updateHydrationStatus();
    activity++;
  }

  function onPostCommit(_rendererId: number, root: FiberRoot): void {
    const seq = awaitingEffects.get(root);
    if (seq === undefined) return;
    awaitingEffects.delete(root);
    log.flush('effects', seq);
    if (seq > effectsFlushed) effectsFlushed = seq;
    activity++;
  }

  if (options.ignoreSelectors.length > 0) setIgnoreSelectors(options.ignoreSelectors);
  installErrorCapture(sink, options.captureWarnings);
  if (options.captureClientView) installListenerTracking();
  installHook({ onInject, onCommit, onPostCommit });
  log.start();

  const status = (): RuntimeStatus => {
    let pendingBoundaries = 0;
    let pendingWithContent = 0;
    for (const state of roots.values()) {
      if (state.info.tooling) continue;
      pendingBoundaries += state.info.pendingBoundaries;
      for (const node of state.pending) {
        const data = (node as Comment).data;
        if (isBlockingBoundary(node) && (data === '$' || data === '$~' || data === '&')) pendingWithContent++;
      }
    }
    return {
      version: PROTOCOL_VERSION,
      activity,
      navigationId,
      url: location.href,
      readyState: document.readyState,
      hydration,
      renderers: renderers.length,
      roots: Array.from(roots.values()).filter((state) => !state.info.tooling).length,
      pendingBoundaries,
      pendingWithContent,
      time: now(),
      effectsFlushed,
    };
  };

  return {
    version: PROTOCOL_VERSION,
    status,
    drain(): DrainPayload {
      log.flush(ambientPhase());
      const payload: DrainPayload = {
        version: PROTOCOL_VERSION,
        navigationId,
        status: status(),
        renderers: renderers.slice(),
        roots: Array.from(roots.values(), (state) => ({ ...state.info })),
        commits,
        errors,
        batches,
        snapshots,
      };
      if (Object.keys(dropped).length > 0) payload.dropped = dropped;
      commits = [];
      errors = [];
      batches = [];
      snapshots = [];
      dropped = {};
      return payload;
    },
    snapshot(kind: SnapshotKind): number {
      log.flush(ambientPhase());
      return takeSnapshot(kind);
    },
    sources(ids): NodeSource[] {
      const out: NodeSource[] = [];
      for (const id of ids) {
        let node = nodeById(id);
        if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode ?? undefined;
        const fiber = node ? fiberOf(node) : undefined;
        if (!fiber) continue;
        const entry: NodeSource = {
          id,
          owners: ownerChain(fiber),
          stacks: creationStacks(fiber),
          debugSources: debugSources(fiber),
          functions: componentFunctions(fiber, sourceTextOf),
        };
        out.push(entry);
      }
      return out;
    },
    interactionTargets,
    prepareInput,
    inputState,
    observe: observePage,
    rects(ids): NodeRect[] {
      const out: NodeRect[] = [];
      for (const id of ids) {
        let node = nodeById(id);
        if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode ?? undefined;
        if (!node || node.nodeType !== Node.ELEMENT_NODE || !(node as Element).isConnected) continue;
        const box = (node as Element).getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        out.push({ id, x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height });
      }
      return out;
    },
  };
}
