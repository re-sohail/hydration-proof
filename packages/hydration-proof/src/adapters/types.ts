import type { MarkerRule } from '../dom/normalize.ts';
import type { DiscoveredRoute } from '../routes/next.ts';
import type { PackageManager } from '../util/package-manager.ts';

export interface AdapterContext {
  rootDir: string;
  packageManager: PackageManager;
}

export interface AdapterCommands {
  /** Production build command, if the framework needs one. */
  build?: string;
  /** Production server; `{port}` is replaced. */
  start: string;
  /** Development server; `{port}` is replaced. */
  dev: string;
  /** File whose existence means a production build is available. */
  buildOutput?: string;
}

/** Framework integration. Internal in 0.1; public from 0.8. */
export interface Adapter {
  name: string;
  detect(rootDir: string): boolean;
  commands(context: AdapterContext): AdapterCommands;
  discoverRoutes?(context: AdapterContext): DiscoveredRoute[];
  /** Framework markers removed before comparing DOM stages. */
  markers: MarkerRule[];
  /** Host to use for the dev server (Next.js blocks other origins). */
  devHost?: string;
}
