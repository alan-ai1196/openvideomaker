import { runTool } from '@openvideomaker/media';

export interface EncoderInfo {
  /** ffmpeg encoder name, e.g. libx264 or h264_nvenc. */
  name: string;
  codec: 'h264' | 'hevc' | 'av1' | 'other';
  hardware: boolean;
}

export interface EncoderReport {
  software: EncoderInfo[];
  hardware: EncoderInfo[];
}

const KNOWN: Record<string, { codec: EncoderInfo['codec']; hardware: boolean }> = {
  libx264: { codec: 'h264', hardware: false },
  libx265: { codec: 'hevc', hardware: false },
  'libaom-av1': { codec: 'av1', hardware: false },
  svtav1: { codec: 'av1', hardware: false },
  h264_nvenc: { codec: 'h264', hardware: true },
  hevc_nvenc: { codec: 'hevc', hardware: true },
  av1_nvenc: { codec: 'av1', hardware: true },
  h264_amf: { codec: 'h264', hardware: true },
  hevc_amf: { codec: 'hevc', hardware: true },
  h264_qsv: { codec: 'h264', hardware: true },
  hevc_qsv: { codec: 'hevc', hardware: true },
  h264_videotoolbox: { codec: 'h264', hardware: true },
  hevc_videotoolbox: { codec: 'hevc', hardware: true },
};

/**
 * Probe actual encoder availability instead of assuming from GPU brand.
 * Hardware encoders are reported but never silently preferred: the
 * executor falls back to software when hardware encoding fails.
 */
export async function detectEncoders(options?: { ffmpeg?: string }): Promise<EncoderReport> {
  const binary = options?.ffmpeg ?? process.env.OVM_FFMPEG ?? 'ffmpeg';
  const result = await runTool(binary, ['-hide_banner', '-encoders'], { maxOutputBytes: 2 * 1024 * 1024 });
  if (result.code !== 0) {
    throw new Error('ffmpeg -encoders failed: ' + result.stderr.trim().split('\n')[0]);
  }
  const software: EncoderInfo[] = [];
  const hardware: EncoderInfo[] = [];
  for (const line of result.stdout.split('\n')) {
    const match = /^V[.F.SXBD]{5} ([\w-]+)\s/.exec(line.trim());
    if (!match) continue;
    const name = match[1]!;
    const known = KNOWN[name];
    if (!known) continue;
    const info: EncoderInfo = { name, codec: known.codec, hardware: known.hardware };
    (known.hardware ? hardware : software).push(info);
  }
  return { software, hardware };
}

export type EncoderPreference = 'auto' | 'hardware' | 'software';

export interface EncoderChoice {
  name: string;
  codec: 'h264' | 'hevc';
  hardware: boolean;
  /** Human-readable label for the Export dialog. */
  label: string;
}

/** Choose an encoder with graceful fallback: never invent hardware. */
export function chooseVideoEncoder(report: EncoderReport, preference: EncoderPreference = 'auto', codec: 'h264' | 'hevc' = 'h264'): EncoderChoice {
  type Supported = EncoderInfo & { codec: 'h264' | 'hevc' };
  const soft = report.software.find((e): e is Supported => e.codec === codec);
  const hard = report.hardware.find((e): e is Supported => e.codec === codec);
  if (preference === 'hardware' && hard) return { name: hard.name, codec: hard.codec, hardware: true, label: hard.name + ' (hardware)' };
  if (preference === 'software' && soft) return { name: soft.name, codec: soft.codec, hardware: false, label: soft.name + ' (software)' };
  if (preference === 'auto' && hard) {
    // Prefer NVENC-class encoders when several hardware paths exist.
    const all = report.hardware.filter((e): e is Supported => e.codec === codec);
    const preferred = all.find((e) => e.name.endsWith('_nvenc')) ?? hard;
    return { name: preferred.name, codec: preferred.codec, hardware: true, label: preferred.name + ' (hardware)' };
  }
  if (soft) return { name: soft.name, codec: soft.codec, hardware: false, label: soft.name + ' (software)' };
  throw new Error('no supported ' + codec + ' encoder found in this ffmpeg build');
}