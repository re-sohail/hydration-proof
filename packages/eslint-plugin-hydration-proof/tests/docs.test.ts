import { readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import type { Rule } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import plugin, { rules } from '../src/index.ts';

// The examples in docs/rules/*.md are linted: "Incorrect" blocks must be
// reported by their rule, "Correct" blocks must pass the recommended preset.
// A block whose first line is a `// app/...` comment is linted as that App
// Router file with the next preset.

const docsRoot = new URL('../../../docs/rules/', import.meta.url);

interface Block {
  language: string;
  code: string;
}

function blocksBySection(markdown: string): Map<string, Block[]> {
  const sections = new Map<string, Block[]>();
  let section = '';
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith('## ')) section = line.slice(3).trim();
    const fence = /^```(\w+)$/.exec(line);
    if (!fence) continue;
    const body: string[] = [];
    for (index++; index < lines.length && lines[index] !== '```'; index++) body.push(lines[index]!);
    sections.set(section, [...(sections.get(section) ?? []), { language: fence[1]!, code: body.join('\n') }]);
  }
  return sections;
}

/** Counts the top-level functions and classes of a block (each is one example). */
const examples: Rule.RuleModule = {
  meta: { type: 'problem', schema: [], messages: { example: 'example' } },
  create(context) {
    return {
      Program(node) {
        for (const statement of node.body) {
          const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
          if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') {
            context.report({ node: declaration, messageId: 'example' });
          }
        }
      },
    };
  },
};

function lint(block: Block, config: Linter.Config): Linter.LintMessage[] {
  const typescript = block.language === 'tsx' || block.language === 'ts';
  const appFile = /^\/\/ (app\/\S+)/.exec(block.code)?.[1];
  const filename = appFile ?? (typescript ? 'src/Example.tsx' : 'src/Example.jsx');
  const messages = new Linter().verify(
    block.code,
    [
      { files: ['**/*.jsx', '**/*.tsx'], ...(typescript ? { languageOptions: { parser: tsParser as Linter.Parser } } : {}) },
      appFile ? plugin.configs.next : config,
      { plugins: { docs: { rules: { examples } } }, rules: { 'docs/examples': 'warn' } },
    ],
    filename,
  );
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${fatal.message}\n${block.code}`);
  return messages;
}

describe.each(Object.keys(rules))('docs/rules/%s.md examples', (name) => {
  const sections = blocksBySection(readFileSync(new URL(`${name}.md`, docsRoot), 'utf8'));
  const code = (section: string): Block[] => (sections.get(section) ?? []).filter((block) => ['jsx', 'tsx'].includes(block.language));

  it('has incorrect and correct examples', () => {
    expect(code('Incorrect').length).toBeGreaterThan(0);
    expect(code('Correct').length).toBeGreaterThan(0);
  });

  it('reports every incorrect example', () => {
    for (const block of code('Incorrect')) {
      const only: Linter.Config = {
        plugins: { 'hydration-proof': plugin },
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: { [`hydration-proof/${name}`]: 'error' },
      };
      const messages = lint(block, only);
      const count = messages.filter((message) => message.ruleId === 'docs/examples').length;
      const reports = messages.filter((message) => message.ruleId === `hydration-proof/${name}`);
      expect(count, block.code).toBeGreaterThan(0);
      expect(reports.length, block.code).toBeGreaterThanOrEqual(count);
    }
  });

  it('accepts every correct example with the recommended preset', () => {
    for (const block of code('Correct')) {
      const reports = lint(block, plugin.configs.recommended).filter((message) => message.ruleId !== 'docs/examples');
      expect(reports.map((message) => `${message.line}: ${message.message}`), block.code).toEqual([]);
    }
  });
});
