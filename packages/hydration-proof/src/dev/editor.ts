import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path';

// Open a file at a line in the developer's editor (no dependencies).
// HYDRATION_PROOF_EDITOR, VISUAL or EDITOR win; otherwise the first known
// editor found on PATH is used.

const KNOWN = ['cursor', 'code', 'windsurf', 'codium', 'zed', 'webstorm', 'idea', 'subl'];

export function which(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isAbsolute(command)) return existsSync(command) ? command : undefined;
  const extensions = process.platform === 'win32' ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, command + extension.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Split an editor setting like `code --wait` into command and arguments. */
function splitCommand(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, '')) ?? [];
}

export function editorArguments(editor: string, file: string, line: number, column = 1): string[] {
  const name = basename(editor).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  if (['code', 'code-insiders', 'cursor', 'windsurf', 'codium', 'vscodium'].includes(name)) return ['-g', `${file}:${line}:${column}`];
  if (['zed', 'subl', 'sublime_text', 'atom'].includes(name)) return [`${file}:${line}:${column}`];
  if (['webstorm', 'idea', 'phpstorm', 'pycharm', 'goland', 'rubymine', 'rider', 'clion'].includes(name)) return ['--line', String(line), '--column', String(column), file];
  if (['vim', 'nvim', 'vi', 'emacs', 'nano', 'micro', 'hx', 'helix'].includes(name)) return [`+${line}`, file];
  return [file];
}

export interface OpenResult {
  opened: boolean;
  message: string;
}

/** Open `file` at `line` if it lies inside `allowedRoot`. */
export function openInEditor(file: string, line: number, column: number | undefined, allowedRoot: string, env: NodeJS.ProcessEnv = process.env): OpenResult {
  const absolute = isAbsolute(file) ? file : resolve(allowedRoot, file);
  let real: string;
  let root: string;
  try {
    real = realpathSync(absolute);
    root = realpathSync(allowedRoot);
  } catch {
    return { opened: false, message: `${file} does not exist.` };
  }
  if (relative(root, real).startsWith('..') || isAbsolute(relative(root, real))) {
    return { opened: false, message: `Not opening ${file}: it is outside the project.` };
  }
  const configured = env['HYDRATION_PROOF_EDITOR'] || env['VISUAL'] || env['EDITOR'];
  const parts = configured ? splitCommand(configured) : [];
  const command = parts[0] ? (which(parts[0], env) ?? parts[0]) : KNOWN.map((name) => which(name, env)).find(Boolean);
  if (!command) {
    return { opened: false, message: `No editor found. Set HYDRATION_PROOF_EDITOR (for example "code") to open ${real}:${line}.` };
  }
  const args = [...parts.slice(1), ...editorArguments(command, real, line, column)];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
    return { opened: true, message: `Opened ${relative(root, real)}:${line} in ${basename(command)}.` };
  } catch (error) {
    return { opened: false, message: `Could not start ${command}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
