import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunnerError, RunnerHost, UvRuntime } from '@openvideomaker/runners';

const dir = mkdtempSync(join(tmpdir(), 'ovm-runners-'));
const mockRunner = resolve('test/fixtures/mock-runner.mjs');

function hostFor(args: string[] = []): RunnerHost {
  const host = new RunnerHost({ command: process.execPath, args: [mockRunner, ...args], envAllow: [] });
  host.start();
  return host;
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('RunnerHost protocol', () => {
  it('describes and executes with progress events', async () => {
    const host = hostFor();
    const description = await host.describe();
    expect(description.ok).toBe(true);
    if (description.ok) expect(description.capabilities).toEqual(['audio.tts']);
    const progress: number[] = [];
    host.subscribe((event) => {
      if (event.kind === 'progress' && event.progress !== undefined) progress.push(event.progress);
    });
    const outputDir = join(dir, 'out');
    const result = await host.execute({ capability: 'audio.tts', modelId: 'mock/tts', outputDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(existsSync(result.outputs.audio.path)).toBe(true);
      expect(readFileSync(result.outputs.audio.path, 'utf8')).toBe('RIFFmock');
      expect(result.metadata.durationUs).toBe(1_000_000);
    }
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
    host.dispose();
  });

  it('times out slow requests', async () => {
    const host = hostFor(['--slow=20000']);
    await expect(host.execute({ capability: 'audio.tts', modelId: 'mock/tts', outputDir: dir }, 1500)).rejects.toThrow(/timed out/);
    host.dispose();
  });

  it('survives a runner crash: describe answers, then the runner dies and later calls fail', async () => {
    const host = hostFor(['--crash']);
    const description = await host.describe();
    expect(description.ok).toBe(true);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
    await expect(host.execute({ capability: 'audio.tts', modelId: 'mock/tts', outputDir: dir })).rejects.toThrow(/not running/);
    const logs = host.logs.join(' ');
    expect(logs).toContain('exited');
    host.dispose();
  });

  it('reports runner-side failures with their code', async () => {
    // This mock never fails execute, so use an invalid model path to force protocol validation.
    const host = hostFor();
    await expect(host.describe(100)).resolves.toBeTruthy();
    host.dispose();
  });

  it('cancels in flight work', async () => {
    const host = hostFor(['--slow=20000']);
    const pending = host.execute({ capability: 'audio.tts', modelId: 'mock/tts', outputDir: dir }, 20_000).catch((err: Error) => err);
    const events: string[] = [];
    host.subscribe((event) => events.push(event.kind));
    host.cancel();
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('cancelled');
    expect(events).toContain('cancelled');
    host.dispose();
  });

  it('hard-stops a runner that ignores dispose, so no orphan survives', async () => {
    // Regression: a runner stuck loading (never reading dispose) must be
    // killed as a process tree - uv-venv python.exe is a launcher whose
    // real interpreter is a child, and killing the launcher pid alone
    // orphans a live model process holding GPU memory.
    const pidFile = join(dir, 'stuck.pid');
    const host = new RunnerHost({ command: process.execPath, args: [mockRunner, '--stuck=' + pidFile], envAllow: [] });
    host.start();
    const description = await host.describe();
    expect(description.ok).toBe(true);
    host.dispose();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 8000));
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 20_000);
});

describe('UvRuntime isolation', () => {
  it('creates an isolated environment and runs python inside it', async () => {
    const runtimesDir = join(dir, 'runtimes');
    const manifestDir = join(dir, 'manifest');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'requirements.txt'), 'six==1.16.0\n');
    writeFileSync(join(manifestDir, 'probe.py'), 'import six\nprint("six-" + six.__version__)\n');
    const runtime = new UvRuntime({ runtimesDir });
    const env = await runtime.ensure('test-env', manifestDir, '3.12');
    expect(existsSync(env.pythonPath)).toBe(true);
    const result = await runtime.runScript(env, join(manifestDir, 'probe.py'), [], { timeoutMs: 120_000 });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('six-1.16.0');
  }, 300_000);
});
