// Wire format between the in-page runtime and the Node engine.
//
// This file must stay free of DOM and Node types: it is compiled by both
// tsconfig.json (Node) and tsconfig.browser.json (page).
//
// Bump PROTOCOL_VERSION on any breaking change. The engine refuses to read a
// payload from a different version instead of guessing.

export const PROTOCOL_VERSION = 1;

/** Name of the non-enumerable global the runtime exposes on `window`. */
export const RUNTIME_GLOBAL = '__HYDRATION_PROOF__';

/** Global the engine sets (in the same init script) to pass RuntimeOptions. */
export const RUNTIME_OPTIONS_GLOBAL = '__HYDRATION_PROOF_OPTIONS__';

/** Stable per-page identifier of a DOM node. */
export type NodeId = number;

// ---------------------------------------------------------------------------
// Serialized DOM
// ---------------------------------------------------------------------------

export const ELEMENT = 1;
export const TEXT = 3;
export const COMMENT = 8;
export const DOCUMENT = 9;
export const DOCTYPE = 10;
export const FRAGMENT = 11;

/** Live form state that is not reflected in attributes. */
export interface FormState {
  value?: string;
  checked?: boolean;
  selected?: boolean;
  indeterminate?: boolean;
}

/**
 * What React will render for an element on the client, read from the host
 * props React stores on the node. Only attributes the audit understands are
 * listed; everything else is left out rather than guessed.
 */
export interface ClientView {
  /** Attribute name -> expected value (`null` = React renders no attribute). */
  attrs: Record<string, string | null>;
  /** Attribute names whose props were present but not audited. */
  skipped?: string[];
  /** The element had `suppressHydrationWarning`. */
  suppress?: true;
  /** Element text React expects when its only child is text. */
  text?: string;
  /** Expected `style` attribute, normalized through the browser's CSSOM. */
  style?: string;
  /** Live `style` attribute at capture time, normalized the same way. */
  domStyle?: string;
  /** `dangerouslySetInnerHTML` equals the live markup after normalization. */
  htmlMatch?: boolean;
  /** Why the element is not audited at all. */
  opaque?: string;
}

export interface SElement {
  k: typeof ELEMENT;
  id: NodeId;
  /** Lower-case for HTML, original case for SVG/MathML. */
  tag: string;
  ns?: 'svg' | 'math';
  /** Attributes in document order. */
  attrs: [name: string, value: string][];
  children: SNode[];
  /** Open or closed shadow root content. */
  shadow?: SNode[];
  /** `<template>` content. */
  content?: SNode[];
  form?: FormState;
  /** Client-side expectation captured from React, when the node is React-owned. */
  client?: ClientView;
  /** Name of the component that rendered this host element, when known. */
  owner?: string;
}

export interface SText {
  k: typeof TEXT;
  id: NodeId;
  text: string;
  /** Text React expects for this node, when it differs from `text`. */
  client?: string;
}

export interface SComment {
  k: typeof COMMENT;
  id: NodeId;
  text: string;
}

export interface SDoctype {
  k: typeof DOCTYPE;
  id: NodeId;
  name: string;
}

export interface SFragment {
  k: typeof DOCUMENT | typeof FRAGMENT;
  id: NodeId;
  children: SNode[];
}

export type SNode = SElement | SText | SComment | SDoctype;
export type SParent = SElement | SFragment;

// ---------------------------------------------------------------------------
// Mutation log
// ---------------------------------------------------------------------------

/**
 * When a batch of DOM mutations happened, relative to React's work.
 *
 * - `loading`: before any React renderer was injected (parser, early scripts)
 * - `pre-hydration`: renderer injected, no hydration commit yet
 * - `react-stream`: React's streaming instructions ($RC, $RS, ...) moved
 *   boundary content; recognised by the S:/P:/B: nodes and Suspense markers
 * - `hydration-commit`: inside a commit that hydrated a root or boundary
 * - `commit`: inside any other React commit
 * - `effects`: between a commit and its post-commit (passive effects)
 * - `async`: delivered to the observer outside any of the above
 */
export type BatchPhase =
  | 'loading'
  | 'pre-hydration'
  | 'react-stream'
  | 'hydration-commit'
  | 'commit'
  | 'effects'
  | 'async';

export type MutationEntry =
  | {
      t: 'attr';
      target: NodeId;
      name: string;
      ns?: string;
      old: string | null;
    }
  | {
      t: 'text';
      target: NodeId;
      old: string;
    }
  | {
      t: 'child';
      target: NodeId;
      prev: NodeId | null;
      next: NodeId | null;
      added: NodeId[];
      /** Removed nodes, serialized when the record was processed. */
      removed: SNode[];
    };

export interface MutationBatch {
  seq: number;
  phase: BatchPhase;
  /** Milliseconds since the runtime started. */
  time: number;
  /** Set for commit phases. */
  commit?: number;
  /** Full entries. Present for commit/stream/effect batches. */
  entries?: MutationEntry[];
  /** Summary only (loading / pre-hydration / async batches). */
  summary?: { attrs: number; texts: number; added: number; removed: number; targets: string[] };
}

// ---------------------------------------------------------------------------
// React state
// ---------------------------------------------------------------------------

export interface RendererInfo {
  id: number;
  version: string;
  packageName: string;
  /** 0 = production, 1 = development. */
  bundleType: number;
  time: number;
}

export interface RootInfo {
  id: number;
  rendererId: number;
  /** DOM container React was mounted into. */
  container: NodeId;
  containerSelector: string;
  identifierPrefix?: string;
  /** How the root started. */
  mode: 'hydrate' | 'client';
  hydratedAt?: number;
  /** Boundaries still waiting to hydrate. */
  pendingBoundaries: number;
}

export type CommitKind = 'hydration' | 'boundary-hydration' | 'update';

export interface CommitInfo {
  seq: number;
  rootId: number;
  kind: CommitKind;
  time: number;
  /** React reported that this commit recovered from an error. */
  didError: boolean;
  /** Dehydrated boundaries before and after this commit. */
  pendingBefore: number;
  pendingAfter: number;
  /** Snapshot taken inside this commit (hydration kinds only). */
  snapshot?: number;
}

export type ErrorSource =
  | 'recoverable'
  | 'caught'
  | 'uncaught'
  | 'window-error'
  | 'unhandled-rejection'
  | 'report-error'
  | 'console-error'
  | 'console-warn';

export interface CapturedError {
  seq: number;
  time: number;
  source: ErrorSource;
  /** Formatted message (printf-style substitutions applied). */
  message: string;
  name?: string;
  stack?: string;
  digest?: string;
  componentStack?: string;
  cause?: Omit<CapturedError, 'seq' | 'time' | 'source'>;
  /** Same number for every report of the same error object. */
  errorId?: number;
  /** Raw console arguments, stringified. */
  args?: string[];
  rootId?: number;
  /** Commit sequence number this error was reported in, if any. */
  commit?: number;
  /** Where the page called console.* (first non-runtime frame). */
  callSite?: string;
}

export type SnapshotKind = 'hydration' | 'post-effect' | 'stable' | 'manual';

export interface Snapshot {
  seq: number;
  kind: SnapshotKind;
  time: number;
  commit?: number;
  /** Id of the serialized subtree root (the document for full snapshots). */
  root: NodeId;
  tree: SFragment;
}

export type HydrationStatus =
  | 'waiting'
  | 'hydrating'
  | 'done'
  | 'client-only'
  | 'no-react';

export interface RuntimeStatus {
  version: number;
  /** Increments on every DOM mutation batch and React commit. */
  activity: number;
  navigationId: string;
  url: string;
  readyState: string;
  hydration: HydrationStatus;
  renderers: number;
  roots: number;
  pendingBoundaries: number;
  time: number;
  /** Commit sequence of the latest hydration commit whose passive effects have flushed. */
  effectsFlushed: number;
}

/** Everything the runtime has buffered since the previous drain. */
export interface DrainPayload {
  version: number;
  navigationId: string;
  status: RuntimeStatus;
  renderers: RendererInfo[];
  roots: RootInfo[];
  commits: CommitInfo[];
  errors: CapturedError[];
  batches: MutationBatch[];
  snapshots: Snapshot[];
  /** Set when a buffer overflowed and data was dropped. */
  dropped?: { batches?: number; errors?: number; entries?: number };
}

/** Options the engine passes to the runtime before any page script runs. */
export interface RuntimeOptions {
  /** Cap on full mutation entries kept per batch. */
  maxEntriesPerBatch: number;
  /** Cap on buffered errors. */
  maxErrors: number;
  /** Serialize client expectations (props audit) into snapshots. */
  captureClientView: boolean;
  /** Capture console.warn in addition to console.error. */
  captureWarnings: boolean;
}

export const DEFAULT_RUNTIME_OPTIONS: RuntimeOptions = {
  maxEntriesPerBatch: 20_000,
  maxErrors: 500,
  captureClientView: true,
  captureWarnings: true,
};

/** The object the runtime installs at `window[RUNTIME_GLOBAL]`. */
export interface RuntimeApi {
  version: number;
  status(): RuntimeStatus;
  drain(): DrainPayload;
  /** Serialize the whole document now; returns the snapshot sequence number. */
  snapshot(kind: SnapshotKind): number;
}
