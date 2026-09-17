import { styleText } from 'node:util';

// Terminal colours via Node's built-in styleText, which already honours
// NO_COLOR, FORCE_COLOR and non-TTY output.

type Format = Parameters<typeof styleText>[0];

function paint(format: Format, stream: NodeJS.WriteStream): (text: string) => string {
  return (text) => {
    try {
      return styleText(format, text, { stream });
    } catch {
      return text;
    }
  };
}

export interface Palette {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  gray(text: string): string;
}

export function palette(stream: NodeJS.WriteStream = process.stdout): Palette {
  return {
    bold: paint('bold', stream),
    dim: paint('dim', stream),
    red: paint('red', stream),
    green: paint('green', stream),
    yellow: paint('yellow', stream),
    cyan: paint('cyan', stream),
    gray: paint('gray', stream),
  };
}

export const symbols: { pass: string; fail: string; warn: string; info: string; error: string } =
  process.platform === 'win32' && !process.env['WT_SESSION']
    ? { pass: '√', fail: '×', warn: '!', info: 'i', error: '×' }
    : { pass: '✓', fail: '✖', warn: '⚠', info: 'ℹ', error: '✖' };

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}
