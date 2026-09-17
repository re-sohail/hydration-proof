import type { Adapter, AdapterCommands, AdapterContext, AdapterNavigation } from '../adapters/types.ts';
import type { RouteEntry } from '../config/types.ts';
import type { MarkerRule } from '../dom/normalize.ts';
import type { Issue } from '../report/model.ts';
import type { Reporter } from '../report/reporters/types.ts';
import type { DiscoveredRoute } from '../routes/next.ts';
import type { SElement, SFragment, SNode } from '../shared/protocol.ts';

// The extension API: adapters for other frameworks, and plugins that add
// normalizers, cause detectors, reporters and route providers.

/** A serialized DOM node (element, text, comment, ...), as normalizers see it. */
export type DomNode = SNode;
export type DomElement = SElement;
export type DomFragment = SFragment;

/** Removes framework markup before DOM stages are compared. */
export interface NormalizerRule {
  name: string;
  /** `drop` removes the node; `opaque` keeps the element but never compares its content. */
  match(node: DomNode, parent: DomElement | DomFragment): 'drop' | 'opaque' | undefined;
}

export interface DetectorContext {
  /** Source around the element, when it was found. */
  source?: { file: string; line: number; content: string };
  /** Browser settings of the scenario. */
  scenario: { locale?: string; timezoneId?: string; colorScheme?: string };
}

export interface DetectedCause {
  /** Kebab-case cause id, e.g. `feature-flag`. */
  id: string;
  title: string;
  /** 0–1; the cause with the highest confidence wins. */
  confidence: number;
  /** Shown as evidence. */
  reason?: string;
  /** Shown before the generic suggestions. */
  fixes?: string[];
  docsUrl?: string;
}

/** Explains findings with knowledge about your app or libraries. */
export interface CauseDetector {
  name: string;
  detect(issue: Readonly<Issue>, context: DetectorContext): DetectedCause | undefined;
}

export interface RouteProviderContext {
  rootDir: string;
  /** The running app. */
  baseUrl: string;
}

/** Adds routes to test (from a CMS, a database, an API, ...). */
export interface RouteProvider {
  name: string;
  routes(context: RouteProviderContext): Promise<(string | RouteEntry)[]> | (string | RouteEntry)[];
}

export interface HydrationProofPlugin {
  name: string;
  adapters?: Adapter[];
  normalizers?: NormalizerRule[];
  /** Attributes that are never compared. */
  ignoreAttributes?: (string | RegExp)[];
  detectors?: CauseDetector[];
  reporters?: Reporter[];
  routes?: RouteProvider[];
}

/** Identity helper with type checking for plugins. */
export function definePlugin(plugin: HydrationProofPlugin): HydrationProofPlugin {
  return plugin;
}

/** A route an adapter found. `file` is relative to the project root. */
export type AdapterRoute = DiscoveredRoute;

export interface AdapterDefinition {
  name: string;
  /** Whether the adapter fits the project (used with `adapter: 'auto'`). Default: never. */
  detect?(rootDir: string): boolean;
  /** Build, start and dev commands. `{port}` is replaced; `PORT` is also set. */
  commands?(context: AdapterContext): AdapterCommands;
  discoverRoutes?(context: AdapterContext): AdapterRoute[];
  normalizers?: NormalizerRule[];
  ignoreAttributes?: (string | RegExp)[];
  /** Attributes the framework changes on its wrapper elements, by tag name. */
  elementAttributes?: Record<string, (string | RegExp)[]>;
  devHost?: string;
  navigation?: AdapterNavigation;
  /** Also test a URL that does not exist. */
  notFound?: boolean;
  /** Pages without React are normal (islands architectures). */
  pagesWithoutReact?: boolean;
}

export function toMarker(rule: NormalizerRule): MarkerRule {
  return { id: rule.name, match: (node, parent) => rule.match(node, parent) };
}

/** Create an adapter for a framework hydration-proof does not know. */
export function defineAdapter(definition: AdapterDefinition): Adapter {
  const adapter: Adapter = {
    name: definition.name,
    detect: definition.detect ?? (() => false),
    commands: definition.commands ?? (() => ({ start: '', dev: '' })),
    markers: (definition.normalizers ?? []).map(toMarker),
  };
  if (definition.discoverRoutes) adapter.discoverRoutes = definition.discoverRoutes;
  if (definition.ignoreAttributes) adapter.ignoreAttributes = definition.ignoreAttributes;
  if (definition.elementAttributes) adapter.elementAttributes = definition.elementAttributes;
  if (definition.devHost !== undefined) adapter.devHost = definition.devHost;
  if (definition.navigation) adapter.navigation = definition.navigation;
  if (definition.notFound !== undefined) adapter.notFound = definition.notFound;
  if (definition.pagesWithoutReact !== undefined) adapter.pagesWithoutReact = definition.pagesWithoutReact;
  return adapter;
}

export type { Adapter, AdapterCommands, AdapterContext, AdapterNavigation };
