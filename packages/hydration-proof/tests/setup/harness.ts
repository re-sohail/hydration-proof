import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import type { BuildMode, HarnessUrls, ReactVersion } from '../helpers/provided.ts';

const fixtures = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));

function run(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function buildClients(version: ReactVersion): Promise<void> {
  const child = run(`${fixtures}ssr-react${version}`, ['build.ts']);
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  if (code !== 0) throw new Error(`Building the React ${version} harness failed:\n${stderr}`);
}

function startServer(version: ReactVersion, mode: BuildMode, children: ChildProcess[]): Promise<string> {
  const child = run(`${fixtures}ssr-react${version}`, ['serve.ts'], { NODE_ENV: mode, PORT: '0' });
  children.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Harness ${version}/${mode} did not start:\n${output}`)), 30_000);
    const onData = (chunk: Buffer): void => {
      output += String(chunk);
      const match = output.match(/ready (\S+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: Buffer) => (output += String(chunk)));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Harness ${version}/${mode} exited with ${code}:\n${output}`));
    });
  });
}

export default async function setup(project: TestProject): Promise<() => void> {
  await Promise.all([buildClients('18'), buildClients('19')]);
  const children: ChildProcess[] = [];
  const entries = await Promise.all(
    (['18', '19'] as const).flatMap((version) =>
      (['development', 'production'] as const).map(async (mode) => {
        const url = await startServer(version, mode, children);
        return [`${version}-${mode}`, url] as const;
      }),
    ),
  );
  project.provide('harness', Object.fromEntries(entries) as HarnessUrls);
  return () => {
    for (const child of children) child.kill();
  };
}
