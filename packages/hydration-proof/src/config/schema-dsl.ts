// A tiny schema language: validates config objects with precise messages and
// emits the equivalent JSON Schema (for editor completion via `$schema`).

export type Schema =
  | { kind: 'string'; enum?: readonly string[]; description?: string; format?: 'uri' | 'path' }
  | { kind: 'number'; integer?: boolean; minimum?: number; maximum?: number; description?: string }
  | { kind: 'boolean'; description?: string }
  | { kind: 'literal'; value: string | number | boolean; description?: string }
  | { kind: 'regexp'; description?: string }
  | { kind: 'function'; description?: string }
  | { kind: 'any'; description?: string }
  | { kind: 'array'; items: Schema; description?: string; minItems?: number }
  | { kind: 'record'; values: Schema; description?: string }
  | {
      kind: 'object';
      properties: Record<string, Schema>;
      required?: readonly string[];
      description?: string;
    }
  | { kind: 'union'; anyOf: readonly Schema[]; description?: string };

export const s = {
  string: (options: Omit<Extract<Schema, { kind: 'string' }>, 'kind'> = {}): Schema => ({ kind: 'string', ...options }),
  enum: (values: readonly string[], description?: string): Schema => ({
    kind: 'string',
    enum: values,
    ...(description ? { description } : {}),
  }),
  number: (options: Omit<Extract<Schema, { kind: 'number' }>, 'kind'> = {}): Schema => ({ kind: 'number', ...options }),
  boolean: (description?: string): Schema => ({ kind: 'boolean', ...(description ? { description } : {}) }),
  literal: (value: string | number | boolean): Schema => ({ kind: 'literal', value }),
  regexp: (description?: string): Schema => ({ kind: 'regexp', ...(description ? { description } : {}) }),
  fn: (description?: string): Schema => ({ kind: 'function', ...(description ? { description } : {}) }),
  any: (description?: string): Schema => ({ kind: 'any', ...(description ? { description } : {}) }),
  array: (items: Schema, description?: string): Schema => ({ kind: 'array', items, ...(description ? { description } : {}) }),
  record: (values: Schema, description?: string): Schema => ({ kind: 'record', values, ...(description ? { description } : {}) }),
  object: (properties: Record<string, Schema>, description?: string, required?: readonly string[]): Schema => ({
    kind: 'object',
    properties,
    ...(description ? { description } : {}),
    ...(required ? { required } : {}),
  }),
  union: (anyOf: readonly Schema[], description?: string): Schema => ({
    kind: 'union',
    anyOf,
    ...(description ? { description } : {}),
  }),
};

export interface SchemaIssue {
  path: string;
  message: string;
}

function describe(schema: Schema): string {
  switch (schema.kind) {
    case 'string':
      return schema.enum ? schema.enum.map((value) => JSON.stringify(value)).join(' | ') : 'a string';
    case 'number':
      return schema.integer ? 'an integer' : 'a number';
    case 'boolean':
      return 'true or false';
    case 'literal':
      return JSON.stringify(schema.value);
    case 'regexp':
      return 'a RegExp';
    case 'function':
      return 'a function';
    case 'any':
      return 'any value';
    case 'array':
      return 'an array';
    case 'record':
    case 'object':
      return 'an object';
    case 'union':
      return schema.anyOf.map(describe).join(' or ');
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof RegExp) return 'a RegExp';
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value)}`;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

function suggestion(key: string, known: string[]): string {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const score = distance(key.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(key.length / 3)) ? ` Did you mean "${best}"?` : '';
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
}

export function validate(value: unknown, schema: Schema, path = ''): SchemaIssue[] {
  const where = path || '(root)';
  switch (schema.kind) {
    case 'string':
      if (typeof value !== 'string') return [{ path: where, message: `must be ${describe(schema)}, got ${typeName(value)}` }];
      if (schema.enum && !schema.enum.includes(value)) {
        return [{ path: where, message: `must be ${describe(schema)}, got ${JSON.stringify(value)}` }];
      }
      return [];
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return [{ path: where, message: `must be ${describe(schema)}, got ${typeName(value)}` }];
      }
      if (schema.integer && !Number.isInteger(value)) return [{ path: where, message: 'must be an integer' }];
      if (schema.minimum !== undefined && value < schema.minimum) return [{ path: where, message: `must be >= ${schema.minimum}` }];
      if (schema.maximum !== undefined && value > schema.maximum) return [{ path: where, message: `must be <= ${schema.maximum}` }];
      return [];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [{ path: where, message: `must be true or false, got ${typeName(value)}` }];
    case 'literal':
      return value === schema.value ? [] : [{ path: where, message: `must be ${JSON.stringify(schema.value)}` }];
    case 'regexp':
      return value instanceof RegExp ? [] : [{ path: where, message: `must be a RegExp, got ${typeName(value)}` }];
    case 'function':
      return typeof value === 'function' ? [] : [{ path: where, message: `must be a function, got ${typeName(value)}` }];
    case 'any':
      return [];
    case 'array': {
      if (!Array.isArray(value)) return [{ path: where, message: `must be an array, got ${typeName(value)}` }];
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return [{ path: where, message: `must have at least ${schema.minItems} item(s)` }];
      }
      return value.flatMap((item, index) => validate(item, schema.items, join(path, index)));
    }
    case 'record': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [{ path: where, message: `must be an object, got ${typeName(value)}` }];
      }
      return Object.entries(value).flatMap(([key, item]) => validate(item, schema.values, join(path, key)));
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof RegExp) {
        return [{ path: where, message: `must be an object, got ${typeName(value)}` }];
      }
      const record = value as Record<string, unknown>;
      const issues: SchemaIssue[] = [];
      const known = Object.keys(schema.properties);
      for (const key of Object.keys(record)) {
        const child = schema.properties[key];
        if (!child) {
          issues.push({ path: join(path, key), message: `is not a known option.${suggestion(key, known)}` });
          continue;
        }
        if (record[key] === undefined) continue;
        issues.push(...validate(record[key], child, join(path, key)));
      }
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) issues.push({ path: join(path, key), message: 'is required' });
      }
      return issues;
    }
    case 'union': {
      const attempts = schema.anyOf.map((option) => validate(value, option, path));
      if (attempts.some((issues) => issues.length === 0)) return [];
      // Prefer the branch that got furthest (issues nested deeper than this path).
      const deeper = attempts.filter((issues) => issues.every((issue) => issue.path !== where));
      if (deeper.length === 1) return deeper[0]!;
      return [{ path: where, message: `must be ${describe(schema)}, got ${typeName(value)}` }];
    }
  }
}

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(schema: Schema): JsonSchema {
  const withDescription = (out: JsonSchema): JsonSchema =>
    'description' in schema && schema.description ? { description: schema.description, ...out } : out;
  switch (schema.kind) {
    case 'string':
      return withDescription(schema.enum ? { type: 'string', enum: [...schema.enum] } : { type: 'string' });
    case 'number': {
      const out: JsonSchema = { type: schema.integer ? 'integer' : 'number' };
      if (schema.minimum !== undefined) out['minimum'] = schema.minimum;
      if (schema.maximum !== undefined) out['maximum'] = schema.maximum;
      return withDescription(out);
    }
    case 'boolean':
      return withDescription({ type: 'boolean' });
    case 'literal':
      return withDescription({ const: schema.value });
    case 'regexp':
      return withDescription({ type: 'string', format: 'regex', description: 'A RegExp (JavaScript/TypeScript configs only) or a regular expression source string.' });
    case 'function':
      return withDescription({ description: 'A function (JavaScript/TypeScript configs only).' });
    case 'any':
      return withDescription({});
    case 'array':
      return withDescription({ type: 'array', items: toJsonSchema(schema.items) });
    case 'record':
      return withDescription({ type: 'object', additionalProperties: toJsonSchema(schema.values) });
    case 'object': {
      const out: JsonSchema = {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toJsonSchema(value)])),
      };
      if (schema.required?.length) out['required'] = [...schema.required];
      return withDescription(out);
    }
    case 'union':
      return withDescription({ anyOf: schema.anyOf.map(toJsonSchema) });
  }
}
