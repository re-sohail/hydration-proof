import { spawn, type ChildProcess } from 'node:child_process';

// Starts the application under test and stops its whole process tree.
// Mirrors Playwright's webServer behaviour: a shell command, a readiness URL,
// optional reuse of an already running server.

export interface ServerOptions {
  /** Shell command, e.g. `npm run start`. */
  command: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  /** URL polled until the server answers. */
  url: string;
  /** Milliseconds to wait for readiness. */
  timeout: number;
  /** Use a server that is already listening on `url` instead of starting one. */
  reuseExisting?: boolean;
  /** Label used in errors and logs. */
  name?: string;
  /** Called for every output line. */
  onLine?: (line: LogLine) => void;
}

export interface LogLine {
  time: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface RunningServer {
  url: string;
  reused: boolean;
  /** The most recent output lines (bounded). */
  logs(): LogLine[];
  stop(): Promise<void>;
}

export class ServerStartError extends Error {
  override name = 'ServerStartError';
  readonly logs: LogLine[];

  constructor(message: string, logs: LogLine[]) {
    super(message);
    this.logs = logs;
  }
}

const MAX_LOG_LINES = 2_000;
const READY_POLL_MS = 200;

/** A server counts as up for any status that proves something is answering. */
function isReadyStatus(status: number): boolean {
  return (status >= 200 && status < 400) || (status >= 400 && status <= 403);
}

export async function isReachable(url: string, timeout = 2_000): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    await response.body?.cancel();
    return isReadyStatus(response.status);
  } catch {
    return false;
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Already gone.
  }
}

const running = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const child of running) killTree(child, 'SIGKILL');
  });
}

function lineSplitter(stream: 'stdout' | 'stderr', push: (line: LogLine) => void): (chunk: Buffer) => void {
  let pending = '';
  return (chunk) => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const text of lines) push({ time: Date.now(), stream, text });
  };
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const label = options.name ?? options.command;
  if (options.reuseExisting && (await isReachable(options.url))) {
    return { url: options.url, reused: true, logs: () => [], stop: async () => {} };
  }

  const logs: LogLine[] = [];
  const push = (line: LogLine): void => {
    logs.push(line);
    if (logs.length > MAX_LOG_LINES) logs.shift();
    options.onLine?.(line);
  };

  const child = spawn(options.command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  running.add(child);
  installExitHook();
  child.stdout?.on('data', lineSplitter('stdout', push));
  child.stderr?.on('data', lineSplitter('stderr', push));

  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      running.delete(child);
      resolve(code);
    });
    child.once('error', (error) => {
      push({ time: Date.now(), stream: 'stderr', text: String(error) });
      running.delete(child);
      resolve(null);
    });
  });

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || !running.has(child)) return;
    killTree(child, 'SIGTERM');
    const timer = setTimeout(() => killTree(child, 'SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
  };

  const deadline = Date.now() + options.timeout;
  let exitCode: number | null | undefined;
  void exited.then((code) => {
    exitCode = code;
  });
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new ServerStartError(`${label} exited with code ${String(exitCode)} before ${options.url} was ready.`, logs);
    }
    if (await isReachable(options.url)) {
      return { url: options.url, reused: false, logs: () => logs.slice(), stop };
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  await stop();
  throw new ServerStartError(`${label} did not answer at ${options.url} within ${options.timeout}ms.`, logs);
}
