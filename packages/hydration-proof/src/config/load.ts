import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SchemaIssue } from './schema-dsl.ts';
import { validateConfig } from './schema.ts';
import type { HydrationProofConfig } from './types.ts';

export const CONFIG_FILES: readonly string[] = [
  'hydration-proof.config.ts',
  'hydration-proof.config.mts',
  'hydration-proof.config.js',
  'hydration-proof.config.mjs',
  'hydration-proof.config.cjs',
  'hydration-proof.config.json',
];

export class ConfigError extends Error {
  override name = 'ConfigError';
  readonly file: string | undefined;
  readonly issues: SchemaIssue[];

  constructor(message: string, file?: string, issues: SchemaIssue[] = []) {
    super(message);
    this.file = file;
    this.issues = issues;
  }
}

export interface LoadedConfig {
  config: HydrationProofConfig;
  file: string | undefined;
  /** Directory relative paths in the config are resolved against. */
  rootDir: string;
}

export function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const file = join(cwd, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

function explainImportError(error: unknown, file: string): ConfigError {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'ERR_UNKNOWN_FILE_EXTENSION':
      return new ConfigError(
        `Node.js ${process.versions.node} cannot load ${file}. hydration-proof needs Node.js 22.18 or newer for TypeScript configs; ` +
          'alternatively rename the file to hydration-proof.config.mjs.',
        file,
      );
    case 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX':
      return new ConfigError(
        `${file} uses TypeScript syntax that Node.js cannot strip (enums, namespaces or parameter properties). ` +
          `Use plain types instead. Details: ${message}`,
        file,
      );
    case 'ERR_MODULE_NOT_FOUND':
      if (/Cannot find module '\.{1,2}\//.test(message) || /imported from/.test(message)) {
        return new ConfigError(
          `${file} imports a module that could not be found. Relative imports in a native TypeScript config need the file extension (for example './routes.ts'). Details: ${message}`,
          file,
        );
      }
      break;
    default:
      break;
  }
  return new ConfigError(`Could not load ${file}: ${message}`, file);
}

async function importConfig(file: string): Promise<unknown> {
  if (file.endsWith('.json')) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, file);
    }
  }
  let module: Record<string, unknown>;
  try {
    // The query string defeats the module cache so watch mode sees edits.
    const url = `${pathToFileURL(file).href}?mtime=${statSync(file).mtimeMs}`;
    module = (await import(url)) as Record<string, unknown>;
  } catch (error) {
    throw explainImportError(error, file);
  }
  let exported = module['default'] ?? module['config'];
  if (typeof exported === 'function') exported = await (exported as () => unknown)();
  return exported;
}

export function formatIssues(issues: SchemaIssue[]): string {
  return issues.map((issue) => `  • ${issue.path} ${issue.message}`).join('\n');
}

export async function loadConfig(options: { cwd: string; file?: string; validate?: boolean }): Promise<LoadedConfig> {
  const file = options.file
    ? isAbsolute(options.file)
      ? options.file
      : resolve(options.cwd, options.file)
    : findConfigFile(options.cwd);
  if (options.file && !existsSync(file!)) throw new ConfigError(`Config file not found: ${file}`, file);
  if (!file) return { config: {}, file: undefined, rootDir: options.cwd };

  const value = await importConfig(file);
  if (value === undefined || value === null) {
    throw new ConfigError(`${file} has no default export. Export the config with \`export default defineConfig({ ... })\`.`, file);
  }
  const issues = options.validate === false ? [] : validateConfig(value);
  if (issues.length > 0) {
    throw new ConfigError(`Invalid configuration in ${file}:\n${formatIssues(issues)}`, file, issues);
  }
  return { config: value as HydrationProofConfig, file, rootDir: dirname(file) };
}
