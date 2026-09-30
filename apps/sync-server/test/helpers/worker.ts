import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RunningWorker {
  port: number;
  stop(): Promise<void>;
}

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** wrangler's own entry point: run with node directly, so no npx or shell sits in between. */
const WRANGLER = join(
  dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
);
const POSIX = process.platform !== 'win32';
/** How long wrangler gets to shut down on SIGTERM before its process group is killed. */
const GRACE_MS = 10_000;

async function waitForHealth(port: number, child: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${logs.join('')}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler did not become healthy:\n${logs.join('')}`);
}

/** Resolves once nothing answers on the port any more (the next worker can bind it). */
async function waitForPortFree(port: number): Promise<void> {
  const deadline = Date.now() + GRACE_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`port ${port} is still answering after the worker stopped`);
}

/** Signals a whole process group, ignoring one that is already gone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group has already exited.
  }
}

export async function startWorker(opts: {
  port: number;
  persistDir: string;
}): Promise<RunningWorker> {
  const logs: string[] = [];
  const child = spawn(
    process.execPath,
    [
      WRANGLER,
      'dev',
      '--port',
      String(opts.port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      opts.persistDir,
      '--var',
      'ROOM_SECRET:test-secret',
    ],
    {
      cwd: SERVER_DIR,
      // On POSIX wrangler leads its own process group, so stop() can end it together with the
      // workerd runtime it starts (the equivalent of `taskkill /T` on Windows).
      detached: POSIX,
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    },
  );
  child.stdout?.on('data', (d) => logs.push(String(d)));
  child.stderr?.on('data', (d) => logs.push(String(d)));
  await waitForHealth(opts.port, child, logs);
  return {
    port: opts.port,
    async stop() {
      const pid = child.pid;
      if (child.exitCode !== null || child.signalCode !== null || pid === undefined) return;
      const exited = once(child, 'exit');
      if (!POSIX) {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
        await exited;
        return;
      }
      // A single SIGINT to one process is not enough on Linux: the tree may never exit. End the
      // whole group, and kill it if it has not exited within the grace period.
      signalGroup(pid, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(pid, 'SIGKILL'), GRACE_MS);
      await exited;
      clearTimeout(timer);
      // workerd may outlive wrangler for a moment.
      signalGroup(pid, 'SIGKILL');
      await waitForPortFree(opts.port);
    },
  };
}
