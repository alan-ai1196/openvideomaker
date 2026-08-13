import { MediaInfoSchema, type MediaInfo, type RationalFps } from '@openvideomaker/schema';
import { runTool } from './run.js';
import { MediaError, type ProbeResult } from './types.js';

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  codec_name?: string;
  channels?: number;
  sample_rate?: string;
}

interface FfprobeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: FfprobeStream[];
}

function parseRate(rate: string | undefined): RationalFps | undefined {
  if (!rate) return undefined;
  const parts = rate.split('/');
  const num = Number(parts[0]);
  const den = parts.length > 1 ? Number(parts[1]) : 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return undefined;
  return { num, den };
}

const IMAGE_FORMATS = /png|jpeg|jpg|webp|gif|bmp|tiff|image2/;

/**
 * Probe a media file with ffprobe and return schema-valid MediaInfo.
 * Rational frame rates (e.g. 30000/1001) are preserved exactly.
 */
export async function probeMediaPath(path: string, options?: { ffprobe?: string; timeoutMs?: number }): Promise<ProbeResult> {
  const binary = options?.ffprobe ?? process.env.OVM_FFPROBE ?? 'ffprobe';
  const result = await runTool(
    binary,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { timeoutMs: options?.timeoutMs ?? 60_000 },
  );

  if (result.code !== 0) {
    throw new MediaError('probe.failed', 'ffprobe failed for ' + path + ': ' + result.stderr.trim().split('\n')[0], {
      command: binary + ' ' + path,
    });
  }

  let data: FfprobeOutput;
  try {
    data = JSON.parse(result.stdout) as FfprobeOutput;
  } catch (err) {
    throw new MediaError('probe.invalid-output', 'ffprobe returned unparseable output', { cause: err });
  }

  const video = data.streams?.find((s) => s.codec_type === 'video');
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  const formatName = data.format?.format_name ?? '';
  const durationUs = data.format?.duration !== undefined ? Math.round(Number(data.format.duration) * 1_000_000) : 0;

  const media: MediaInfo = {
    durationUs,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    ...(video ? { width: video.width, height: video.height, fps: parseRate(video.r_frame_rate ?? video.avg_frame_rate), codec: video.codec_name } : {}),
    ...(audio ? { audioChannels: audio.channels, sampleRate: audio.sample_rate !== undefined ? Number(audio.sample_rate) : undefined } : {}),
    format: formatName.split(',')[0],
  };

  const kind: ProbeResult['kind'] = IMAGE_FORMATS.test(formatName) ? 'image' : audio && !video ? 'audio' : 'video';
  return { media: MediaInfoSchema.parse(media), kind };
}
