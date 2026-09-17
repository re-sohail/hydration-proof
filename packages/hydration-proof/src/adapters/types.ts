import type { MarkerRule } from '../dom/normalize.ts';
import type { DiscoveredRoute } from '../routes/next.ts';
import type { PackageManager } from '../util/package-manager.ts';

export interface AdapterContext {
  rootDir: string;
  packageManager: PackageManager;
}

export interface AdapterCommands {
  /** Environment for the app server (for example HOST). */
  env?: Record<string, string>;
  /** Production build command, if the framework needs one. */
  build?: string;
  /** Production server; `{port}` is replaced. */
  start: string;
  /** Development server; `{port}` is replaced. */
  dev: string;
  /** File whose existence means a production build is available. */
  buildOutput?: string;
}

/** Client-side navigation inside the app (page function sources taking the URL). */
export interface AdapterNavigation {
  /** Starts a client-side navigation; returns false when the router is not available. */
  navigate: string;
  /** Prefetches a route; returns false when not supported. */
  prefetch?: string;
}

/** Framework integration: how to build, start and discover an app, and what to ignore in its HTML. */
export interface Adapter {
  name: string;
  detect(rootDir: string): boolean;
  commands(context: AdapterContext): AdapterCommands;
  discoverRoutes?(context: AdapterContext): DiscoveredRoute[];
  /** Framework markers removed before comparing DOM stages. */
  markers: MarkerRule[];
  /** Attributes the framework adds or changes on its own (never compared). */
  ignoreAttributes?: readonly (string | RegExp)[];
  /** Attributes the framework changes on its own wrapper elements, by tag name. */
  elementAttributes?: Readonly<Record<string, readonly (string | RegExp)[]>>;
  /** Host to use for the dev server (Next.js blocks other origins). */
  devHost?: string;
  navigation?: AdapterNavigation;
  /** Also load a URL that does not exist, to check the not-found page (default false). */
  notFound?: boolean;
  /** Pages without React are normal (islands architectures); they are not reported. */
  pagesWithoutReact?: boolean;
  /** Label for source paths in reports, e.g. strip a bundler prefix. */
  sourcePath?(source: string): string | undefined;
}
