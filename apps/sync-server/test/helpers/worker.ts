import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export interface RunningWorker {
  port: number;
  stop(): Promise<void>;
}

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));

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

export async function startWorker(opts: {
  port: number;
  persistDir: string;
}): Promise<RunningWorker> {
  const logs: string[] = [];
  const child = spawn(
    'npx',
    [
      'wrangler',
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
      shell: process.platform === 'win32',
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    },
  );
  child.stdout?.on('data', (d) => logs.push(String(d)));
  child.stderr?.on('data', (d) => logs.push(String(d)));
  await waitForHealth(opts.port, child, logs);
  return {
    port: opts.port,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } else {
        child.kill('SIGINT');
      }
      await exited;
    },
  };
}
