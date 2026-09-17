// Migrations for configs written for an older version. Every change is
// reported; simple ones can be applied to the file.

export interface ConfigChange {
  /** What to change, as a path in the config. */
  from: string;
  to?: string;
  /** Why, and what to do when it cannot be applied automatically. */
  note: string;
  /** A rename of one key that can be applied to the file text. */
  rename?: { key: string; to: string };
}

type Record_ = Record<string, unknown>;

const isObject = (value: unknown): value is Record_ => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Changes an old config needs. The config is not modified. */
export function planMigrations(config: unknown): ConfigChange[] {
  const changes: ConfigChange[] = [];
  if (!isObject(config)) return changes;
  const normalize = config['normalize'];
  if (isObject(normalize)) {
    if (normalize['ignoreSelectors'] !== undefined) {
      changes.push({ from: 'normalize.ignoreSelectors', to: 'ignore.selectors', note: 'Ignore rules moved to `ignore`.', rename: { key: 'ignoreSelectors', to: 'selectors' } });
    }
    if (normalize['ignoreAttributes'] !== undefined) {
      changes.push({ from: 'normalize.ignoreAttributes', to: 'ignore.attributes', note: 'Ignore rules moved to `ignore`.', rename: { key: 'ignoreAttributes', to: 'attributes' } });
    }
    if (normalize['maskText'] !== undefined) {
      changes.push({
        from: 'normalize.maskText',
        to: 'redact.patterns',
        note: 'Text masking is now redaction (it applies to every report). Move the patterns to `redact: { patterns: [...] }`.',
      });
    }
    changes.push({ from: 'normalize', to: 'ignore', note: 'The `normalize` section is now `ignore` (plus `redact` for masking).', rename: { key: 'normalize', to: 'ignore' } });
  }
  const server = config['server'];
  if (isObject(server) && server['start'] !== undefined) {
    changes.push({ from: 'server.start', to: 'server.command', note: 'The start command is `server.command`.', rename: { key: 'start', to: 'command' } });
  }
  const checks = config['checks'];
  if (isObject(checks) && (checks['suppressedWarnings'] === 'warn' || checks['suppressedWarnings'] === 'error')) {
    changes.push({
      from: `checks.suppressedWarnings: '${String(checks['suppressedWarnings'])}'`,
      to: "checks.suppressedWarnings: 'info'",
      note: "Use 'off', 'info' or 'strict'.",
      rename: { key: `'${String(checks['suppressedWarnings'])}'`, to: "'info'" },
    });
  }
  const reporters = config['reporters'];
  if (Array.isArray(reporters) && reporters.includes('console')) {
    changes.push({ from: "reporters: 'console'", to: "reporters: 'list'", note: 'The terminal reporter is called `list`.', rename: { key: "'console'", to: "'list'" } });
  }
  const ignore = config['ignore'];
  if (isObject(ignore) && Array.isArray(ignore['issues'])) {
    for (const rule of ignore['issues']) {
      if (isObject(rule) && rule['until'] !== undefined) {
        changes.push({ from: 'ignore.issues[].until', to: 'ignore.issues[].expires', note: 'Expiry dates are `expires`.', rename: { key: 'until', to: 'expires' } });
        break;
      }
    }
  }
  if (config['interactions'] === false || config['interactions'] === true) {
    changes.push({ from: 'interactions: boolean', to: 'checks.interactions', note: 'The switch for the built-in interaction checks is `checks.interactions`; `interactions` is now a list of custom interactions.' });
  }
  if (isObject(config['ci']) && config['ci']['maxWarnings'] !== undefined) {
    changes.push({ from: 'ci.maxWarnings', to: 'ci.budget.warning', note: 'Still supported; budgets can also limit findings per route and per code.' });
  }
  return changes;
}

export interface MigrationResult {
  text: string;
  applied: ConfigChange[];
  manual: ConfigChange[];
}

/**
 * Apply the renames of `changes` to the config source. A rename is only
 * applied when the old key appears exactly once, so nothing else can break.
 */
export function applyMigrations(text: string, changes: readonly ConfigChange[]): MigrationResult {
  let out = text;
  const applied: ConfigChange[] = [];
  const manual: ConfigChange[] = [];
  for (const change of changes) {
    const rename = change.rename;
    if (!rename) {
      manual.push(change);
      continue;
    }
    const quoted = rename.key.startsWith("'");
    const pattern = quoted
      ? new RegExp(rename.key.replace(/'/g, `["']`), 'g')
      : new RegExp(`(^|[{,\\s])(["']?)${rename.key}\\2(\\s*:)`, 'g');
    const matches = [...out.matchAll(pattern)];
    if (matches.length !== 1) {
      manual.push(change);
      continue;
    }
    out = quoted
      ? out.replace(pattern, rename.to.replace(/'/g, out.includes(`"${rename.key.replace(/'/g, '')}"`) ? '"' : "'"))
      : out.replace(pattern, (_match, before: string, quote: string, colon: string) => `${before}${quote}${rename.to}${quote}${colon}`);
    applied.push(change);
  }
  return { text: out, applied, manual };
}
