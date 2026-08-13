import type { DeviceGraph } from './graph.js';

export function formatBytes(bytes: number, unit: 'GiB' | 'MiB' = 'GiB'): string {
  const divisor = unit === 'GiB' ? 1024 ** 3 : 1024 ** 2;
  return (bytes / divisor).toFixed(1) + ' ' + unit;
}

/** Human notes derived from probed capabilities - suggestions, never claims. */
export function doctorRecommendations(graph: DeviceGraph): string[] {
  const notes: string[] = [];
  if (graph.capabilities.hardwareVideoEncode) {
    const names = graph.encoders
      .filter((e) => e.hardware && (e.codec === 'h264' || e.codec === 'hevc'))
      .map((e) => e.name);
    notes.push('Hardware video encoding available: ' + names.join(', ') + '.');
  } else if (graph.capabilities.videoEncode) {
    notes.push('Software video encoding only - no hardware encoder was probed.');
  } else if (graph.ffmpegVersion) {
    notes.push('This ffmpeg build has no supported video encoder - rendering video will fail.');
  } else {
    notes.push('ffmpeg not found - install it (or use the desktop app) to render video.');
  }
  if (graph.gpus.length === 0) {
    notes.push('No GPU reported (nvidia-smi unavailable) - CUDA-dependent models will not run locally.');
  }
  if (!graph.capabilities.aiRunners) {
    notes.push('Neither uv nor Python found - AI runner integrations (TTS, ASR, ...) cannot start yet.');
  }
  return notes;
}

export function formatDoctor(graph: DeviceGraph): string {
  const lines: string[] = [];
  lines.push('OpenVideoMaker device report');
  lines.push('probed: ' + graph.probedAt);
  lines.push('');
  lines.push('OS       ' + [graph.os.platform, graph.os.release, graph.os.arch].join(' ') + '  node ' + graph.os.nodeVersion);
  lines.push('CPU      ' + graph.os.cpuModel + ' (' + graph.os.logicalCores + ' logical cores)');
  lines.push('Memory   ' + formatBytes(graph.os.totalMemoryBytes));
  if (graph.gpus.length === 0) {
    lines.push('GPU      none detected (nvidia-smi unavailable)');
  } else {
    for (const gpu of graph.gpus) {
      const parts: string[] = [gpu.name];
      if (gpu.vramBytes !== undefined) parts.push(formatBytes(gpu.vramBytes));
      if (gpu.driverVersion) parts.push('driver ' + gpu.driverVersion);
      if (gpu.cudaVersion) parts.push('CUDA ' + gpu.cudaVersion);
      lines.push('GPU      ' + parts.join(', '));
    }
  }
  lines.push('');
  lines.push('ffmpeg   ' + (graph.ffmpegVersion ?? 'not found'));
  const hw = graph.encoders.filter((e) => e.hardware).map((e) => e.name + ' (hardware)');
  const sw = graph.encoders.filter((e) => !e.hardware).map((e) => e.name + ' (software)');
  if (hw.length > 0) lines.push('  hardware encoders: ' + hw.join(', '));
  if (sw.length > 0) lines.push('  software encoders: ' + sw.join(', '));
  lines.push('');
  if (graph.runtimes.length === 0) {
    lines.push('runtimes none probed');
  } else {
    lines.push('runtimes');
    for (const r of graph.runtimes) lines.push('  ' + r.name.padEnd(8) + r.version + '  (' + r.command + ')');
  }
  const notes = doctorRecommendations(graph);
  if (notes.length > 0) {
    lines.push('');
    lines.push('notes');
    for (const note of notes) lines.push('  - ' + note);
  }
  if (graph.warnings.length > 0) {
    lines.push('');
    lines.push('warnings');
    for (const warning of graph.warnings) lines.push('  - ' + warning);
  }
  return lines.join('\n');
}
