import { describe, expect, it } from 'vitest';
import { DeviceGraphSchema } from '../src/graph.js';
import { doctorRecommendations, formatBytes, formatDoctor } from '../src/doctor.js';
import { parseNvidiaSmiCsv, probeDeviceGraph, runProbeTool, type ExecFn, type ExecResult } from '../src/probe.js';

/** Exec override: faked outputs by command key, real probing for the rest. */
function fakeExec(overrides: Record<string, string | null>): ExecFn {
  return async (binary, args) => {
    const key = binary + ' ' + args.join(' ');
    if (key in overrides) {
      const out = overrides[key];
      if (out === null) return { code: 1, stdout: '', stderr: 'not found' } satisfies ExecResult;
      return { code: 0, stdout: out, stderr: '' } satisfies ExecResult;
    }
    return runProbeTool(binary, args);
  };
}

const GPU_CSV_KEY = 'nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits';

describe('nvidia-smi csv parsing', () => {
  it('parses name, memory and driver rows', () => {
    expect(parseNvidiaSmiCsv('NVIDIA GeForce RTX 3090, 24576, 581.32\r\nNVIDIA T4, 15109, 570.10\r\n')).toEqual([
      { name: 'NVIDIA GeForce RTX 3090', vramMiB: 24576, driverVersion: '581.32' },
      { name: 'NVIDIA T4', vramMiB: 15109, driverVersion: '570.10' },
    ]);
  });

  it('ignores empty and malformed lines', () => {
    expect(parseNvidiaSmiCsv('\r\n  \n,,garbage\nNVIDIA A100, 40960, 550.54\n')).toEqual([
      { name: 'NVIDIA A100', vramMiB: 40960, driverVersion: '550.54' },
    ]);
  });
});

describe('probeDeviceGraph with faked tools', () => {
  it('reports faked nvidia GPU and runtimes, real node/ffmpeg', async () => {
    const graph = await probeDeviceGraph({
      exec: fakeExec({
        [GPU_CSV_KEY]: 'NVIDIA GeForce RTX 3090, 24576, 581.32',
        'nvidia-smi ': '| NVIDIA-SMI 581.32  KMD Version: 581.32  CUDA UMD Version: 13.3 |',
        'uv --version': 'uv 0.11.7',
        'python --version': 'Python 3.12.10',
      }),
    });
    expect(graph.gpus).toHaveLength(1);
    expect(graph.gpus[0]).toMatchObject({
      vendor: 'nvidia',
      name: 'NVIDIA GeForce RTX 3090',
      vramBytes: 24576 * 1024 * 1024,
      driverVersion: '581.32',
      cudaVersion: '13.3',
    });
    expect(graph.runtimes.find((r) => r.name === 'uv')?.version).toBe('0.11.7');
    expect(graph.runtimes.find((r) => r.name === 'python')?.version).toBe('3.12.10');
    expect(graph.capabilities.aiRunners).toBe(true);
    expect(graph.ffmpegVersion).not.toBeNull();
    expect(graph.capabilities.videoEncode).toBe(true);
  });

  it('treats absent nvidia-smi and python toolchain as clean absence', async () => {
    const graph = await probeDeviceGraph({
      exec: fakeExec({
        [GPU_CSV_KEY]: null,
        'uv --version': null,
        'python --version': null,
        'py -3 --version': null,
      }),
    });
    expect(graph.gpus).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.capabilities.aiRunners).toBe(false);
  });
});

describe('real device probe', () => {
  it('produces a schema-valid graph on this machine', async () => {
    const graph = DeviceGraphSchema.parse(await probeDeviceGraph());
    expect(graph.os.platform).toBe('win32');
    expect(graph.os.nodeVersion).toBe(process.version);
    expect(graph.os.logicalCores).toBeGreaterThan(0);
    expect(graph.ffmpegVersion).not.toBeNull();
    expect(graph.runtimes.find((r) => r.name === 'node')?.version).toBe(process.version.replace(/^v/, ''));
    expect(graph.capabilities.videoEncode).toBe(true);
    for (const gpu of graph.gpus) expect(gpu.vendor).toBe('nvidia');
  });
});

describe('doctor formatting', () => {
  it('formats bytes', () => {
    expect(formatBytes(24576 * 1024 * 1024)).toBe('24.0 GiB');
    expect(formatBytes(1024 * 1024, 'MiB')).toBe('1.0 MiB');
  });

  it('renders a full report with the probed facts', async () => {
    const graph = await probeDeviceGraph();
    const text = formatDoctor(graph);
    expect(text).toContain('OpenVideoMaker device report');
    expect(text).toContain('win32');
    expect(text).toContain('ffmpeg');
    expect(text).toContain('runtimes');
    if (graph.gpus.length > 0) expect(text).toContain('GPU');
  });

  it('derives recommendations from capabilities', async () => {
    const base = await probeDeviceGraph();
    const noGpu = { ...base, gpus: [], capabilities: { ...base.capabilities, hardwareVideoEncode: false } };
    const notes = doctorRecommendations(noGpu);
    expect(notes.join(' ')).toContain('No GPU reported');
    expect(notes.some((n) => n.includes('Software video encoding'))).toBe(true);
  });
});
