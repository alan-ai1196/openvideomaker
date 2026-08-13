/**
 * probeDeviceGraph(): probed facts about this machine, shared by the
 * ovm-doctor CLI today and the Studio Device Center later. Every fact
 * comes from running a tool - hardware is probed, never assumed.
 */
import { arch, availableParallelism, cpus, platform, release, totalmem } from 'node:os';
import { MediaError, runTool } from '@openvideomaker/media';
import { detectEncoders } from '@openvideomaker/render';
import type { EncoderInfo } from '@openvideomaker/render';
import { DeviceGraphSchema, type DeviceGraph, type GpuInfo, type RuntimeInfo, type RuntimeName } from './graph.js';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ExecFn = (binary: string, args: string[], options?: { timeoutMs?: number }) => Promise<ExecResult>;

/** Default executor: argument arrays only, bounded capture, short timeout. */
export function runProbeTool(binary: string, args: string[], options?: { timeoutMs?: number }): Promise<ExecResult> {
  return runTool(binary, args, { timeoutMs: options?.timeoutMs ?? 15_000, maxOutputBytes: 256 * 1024 });
}

export interface ProbeOptions {
  exec?: ExecFn;
  /** ffmpeg binary override (OVM_FFMPEG is honored too). */
  ffmpeg?: string;
  /** ffprobe binary override (OVM_FFPROBE is honored too). */
  ffprobe?: string;
}

export interface NvidiaRow {
  name: string;
  vramMiB: number;
  driverVersion: string;
}

/** Parse `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` output. */
export function parseNvidiaSmiCsv(csv: string): NvidiaRow[] {
  const rows: NvidiaRow[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(',').map((c) => c.trim());
    const name = cells[0];
    const vram = Number.parseFloat(cells[1] ?? '');
    const driverVersion = cells[2] ?? '';
    if (!name || !Number.isFinite(vram)) continue;
    rows.push({ name, vramMiB: vram, driverVersion });
  }
  return rows;
}

/** First match group of `pattern` in stdout+stderr, else null. */
function extractVersion(pattern: RegExp, out: ExecResult): string | null {
  const match = pattern.exec(out.stdout + '\n' + out.stderr);
  return match?.[1] ?? null;
}

/**
 * Run a probe command; a missing or failing tool is absence, not an
 * error, so callers get null instead of an exception.
 */
async function tryRun(exec: ExecFn, binary: string, args: string[]): Promise<ExecResult | null> {
  try {
    const result = await exec(binary, args);
    return result.code === 0 ? result : null;
  } catch (error) {
    if (error instanceof MediaError && error.code === 'tool.missing') return null;
    return null;
  }
}

interface RuntimeProbe {
  name: RuntimeName;
  command: string;
  args: string[];
  pattern: RegExp;
}

async function probeRuntime(exec: ExecFn, probe: RuntimeProbe): Promise<RuntimeInfo | null> {
  const out = await tryRun(exec, probe.command, probe.args);
  if (!out) return null;
  const version = extractVersion(probe.pattern, out);
  if (!version) return null;
  return { name: probe.name, version, command: [probe.command, ...probe.args].join(' ') };
}

export async function probeRuntimes(exec: ExecFn, ffmpeg = process.env.OVM_FFMPEG ?? 'ffmpeg', ffprobe = process.env.OVM_FFPROBE ?? 'ffprobe', uv = process.env.OVM_UV ?? 'uv'): Promise<RuntimeInfo[]> {
  const probes: RuntimeProbe[] = [
    { name: 'node', command: process.execPath, args: ['--version'], pattern: /^v?([0-9.]+)/ },
    { name: 'ffmpeg', command: ffmpeg, args: ['-version'], pattern: /^ffmpeg version (\S+)/ },
    { name: 'ffprobe', command: ffprobe, args: ['-version'], pattern: /^ffprobe version (\S+)/ },
    { name: 'uv', command: uv, args: ['--version'], pattern: /^uv (\S+)/ },
    { name: 'python', command: 'python', args: ['--version'], pattern: /^Python ([0-9.]+)/ },
  ];
  const found: RuntimeInfo[] = [];
  const have = new Set<RuntimeName>();
  for (const probe of probes) {
    const info = await probeRuntime(exec, probe);
    if (info && !have.has(probe.name)) {
      found.push(info);
      have.add(probe.name);
    }
  }
  // Windows often ships the `py` launcher but no bare `python` on PATH.
  if (!have.has('python')) {
    const fallback = await probeRuntime(exec, { name: 'python', command: 'py', args: ['-3', '--version'], pattern: /^Python ([0-9.]+)/ });
    if (fallback) found.push(fallback);
  }
  return found;
}

export async function probeGpus(exec: ExecFn, warnings: string[]): Promise<GpuInfo[]> {
  const csv = await tryRun(exec, 'nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']);
  if (!csv) return []; // no nvidia-smi: absence is data, nothing to warn about
  const rows = parseNvidiaSmiCsv(csv.stdout);
  if (rows.length === 0) {
    warnings.push('nvidia-smi ran but returned no GPU rows');
    return [];
  }
  let cudaVersion: string | undefined;
  const header = await tryRun(exec, 'nvidia-smi', []);
  if (header) {
    // Older drivers print 'CUDA Version: 13.0', newer ones 'CUDA UMD Version: 13.3'.
    cudaVersion = /CUDA (?:UMD )?Version:\s*([0-9.]+)/.exec(header.stdout)?.[1];
  }
  return rows.map((row) => ({
    vendor: 'nvidia',
    name: row.name,
    vramBytes: Math.round(row.vramMiB * 1024 * 1024),
    driverVersion: row.driverVersion || undefined,
    cudaVersion,
  }));
}

export async function probeDeviceGraph(options: ProbeOptions = {}): Promise<DeviceGraph> {
  const exec = options.exec ?? runProbeTool;
  const ffmpeg = options.ffmpeg ?? process.env.OVM_FFMPEG ?? 'ffmpeg';
  const ffprobe = options.ffprobe ?? process.env.OVM_FFPROBE ?? 'ffprobe';
  const warnings: string[] = [];

  const gpus = await probeGpus(exec, warnings);
  const runtimes = await probeRuntimes(exec, ffmpeg, ffprobe);
  const ffmpegVersion = runtimes.find((r) => r.name === 'ffmpeg')?.version ?? null;

  let encoders: EncoderInfo[] = [];
  if (ffmpegVersion) {
    try {
      const report = await detectEncoders({ ffmpeg });
      encoders = [...report.software, ...report.hardware];
    } catch (error) {
      warnings.push('encoder probe failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  const usable = encoders.filter((e) => e.codec === 'h264' || e.codec === 'hevc');
  const capabilities = {
    videoEncode: usable.length > 0,
    hardwareVideoEncode: usable.some((e) => e.hardware),
    aiRunners: runtimes.some((r) => r.name === 'uv' || r.name === 'python'),
  };

  const cpuList = cpus();
  const osInfo = {
    platform: platform(),
    arch: arch(),
    release: release(),
    nodeVersion: process.version,
    cpuModel: cpuList[0]?.model ?? 'unknown',
    logicalCores: cpuList.length,
    parallelism: availableParallelism(),
    totalMemoryBytes: totalmem(),
  };

  return DeviceGraphSchema.parse({
    probedAt: new Date().toISOString(),
    os: osInfo,
    gpus,
    ffmpegVersion,
    encoders,
    runtimes,
    capabilities,
    warnings,
  });
}
