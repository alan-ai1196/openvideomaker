import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunnerError } from './host.js';

export interface UvRuntimeOptions {
  runtimesDir?: string;
  uv?: string;
}

export interface RuntimeEnv {
  name: string;
  pythonPath: string;
  dir: string;
}

const NL = String.fromCharCode(10);

function run(binary: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-8000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', (err) => reject(new RunnerError('runner.spawn', 'failed to start ' + binary + ': ' + err.message)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function tail(lines: string, count: number): string {
  return lines.split(NL).slice(-count).join(' ');
}

/**
 * Isolated, reproducible Python runtimes managed by uv under an
 * OpenVideoMaker-owned directory. Never touches the user's global
 * Python environment.
 */
export class UvRuntime {
  readonly runtimesDir: string;
  readonly uv: string;

  constructor(options: UvRuntimeOptions = {}) {
    this.uv = options.uv ?? process.env.OVM_UV ?? 'uv';
    this.runtimesDir = options.runtimesDir ?? process.env.OVM_RUNTIMES_DIR ?? join(homedir(), '.ovm', 'runtimes');
    mkdirSync(this.runtimesDir, { recursive: true });
  }

  async ensure(name: string, manifestDir: string, pythonVersion = '3.11'): Promise<RuntimeEnv> {
    const dir = join(this.runtimesDir, name);
    const venvPython = join(dir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    if (!existsSync(venvPython)) {
      const created = await run(this.uv, ['venv', '--python', pythonVersion, dir]);
      if (created.code !== 0) {
        throw new RunnerError('runner.spawn', 'uv venv failed: ' + tail(created.stderr, 3));
      }
    }
    const requirements = join(manifestDir, 'requirements.txt');
    if (existsSync(requirements)) {
      // Marker is keyed by the requirements content, so changing the
      // manifest triggers a reinstall while unchanged manifests no-op.
      const marker = join(dir, '.ovm-installed-' + hashFile(requirements));
      if (!existsSync(marker)) {
        const installed = await run(this.uv, ['pip', 'install', '--python', venvPython, '-r', requirements]);
        if (installed.code !== 0) {
          throw new RunnerError('runner.spawn', 'runtime install failed: ' + tail(installed.stderr, 3));
        }
        writeFileSync(marker, new Date().toISOString());
      }
    }
    return { name, pythonPath: venvPython, dir };
  }

  runScript(runtime: RuntimeEnv, script: string, args: string[], options?: { timeoutMs?: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(runtime.pythonPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = options?.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString('utf8')).slice(-8000);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-8000);
      });
      child.on('error', (err) => reject(new RunnerError('runner.spawn', 'failed to start runtime script: ' + err.message)));
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }
}

function homedir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? '.';
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
}
