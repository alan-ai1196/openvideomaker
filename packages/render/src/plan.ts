import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AssetId, Clip, Project, RationalFps } from '@openvideomaker/schema';
import { chooseVideoEncoder, detectEncoders, type EncoderChoice, type EncoderPreference } from './encoders.js';
import { RenderError } from './types.js';

export type SourceResolver = (assetId: AssetId) => string | null;

export interface RenderOptions {
  width: number;
  height: number;
  fps: RationalFps;
  sampleRate: number;
  videoCodec?: 'h264' | 'hevc';
  encoderPreference?: EncoderPreference;
  quality?: 'draft' | 'balanced' | 'high';
  outputPath: string;
}

export interface RenderSource {
  assetId: AssetId;
  path: string;
  index: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface RenderPlan {
  options: RenderOptions;
  encoder: EncoderChoice;
  durationUs: number;
  sources: RenderSource[];
  filterComplex: string;
  outputArgs: string[];
  tempFiles: string[];
  errors: string[];
  warnings: string[];
  textClipCount: number;
  captionCueCount: number;
}

const QUALITY: Record<'draft' | 'balanced' | 'high', { software: number; hardware: number; preset: string }> = {
  draft: { software: 26, hardware: 30, preset: 'medium' },
  balanced: { software: 21, hardware: 24, preset: 'medium' },
  high: { software: 17, hardware: 19, preset: 'slow' },
};

const BS = String.fromCharCode(92);

function sec(us: number): string {
  return (us / 1_000_000).toFixed(4);
}

function defaultFontPath(): string {
  if (process.platform === 'win32') return 'C:/Windows/Fonts/arial.ttf';
  if (process.platform === 'darwin') return '/System/Library/Fonts/Supplemental/Arial.ttf';
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
}

/** Wrap a value in single quotes for filter arguments. */
function q(value: string): string {
  return chr39() + value + chr39();
}

function escapeDrawtext(text: string): string {
  return text
    .split(BS).join(BS + BS)
    .split(':').join(BS + ':')
    .split(chr39()).join(BS + chr39())
    .split('%').join(BS + '%')
    .split(String.fromCharCode(10)).join(' ');
}

function chr39(): string {
  return String.fromCharCode(39);
}

function escapeFilterPath(path: string): string {
  return path
    .split(BS).join('/')
    .split(':').join(BS + ':')
    .split(chr39()).join(BS + chr39());
}

function fitScale(srcW: number, srcH: number, rotation: number, W: number, H: number): { dw: number; dh: number } {
  const swapped = Math.abs(rotation) % 180 === 90;
  const w = swapped ? srcH : srcW;
  const h = swapped ? srcW : srcH;
  const scale = Math.min(W / w, H / h);
  return { dw: Math.round(w * scale), dh: Math.round(h * scale) };
}

export async function buildRenderPlan(
  project: Project,
  options: RenderOptions,
  resolveSource: SourceResolver,
  encoderReport?: Awaited<ReturnType<typeof detectEncoders>>,
): Promise<RenderPlan> {
  const sequenceId = project.activeSequenceId ?? Object.keys(project.sequences)[0];
  const sequence = sequenceId ? project.sequences[sequenceId] : undefined;
  if (!sequence) throw new RenderError('render.no-sequence', 'project has no sequence to render');
  const W = options.width;
  const H = options.height;
  const fps = options.fps;
  const fpsValue = fps.num / fps.den;

  let durationUs = 0;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      durationUs = Math.max(durationUs, clip.start + clip.duration);
    }
  }
  durationUs = Math.max(1_000_000, durationUs);
  const D = durationUs / 1_000_000;

  const report = encoderReport ?? (await detectEncoders());
  const encoder = chooseVideoEncoder(report, options.encoderPreference ?? 'auto', options.videoCodec ?? 'h264');

  const errors: string[] = [];
  const warnings: string[] = [];
  const sources: RenderSource[] = [];
  const sourceIndex = new Map<AssetId, number>();
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled || clip.kind !== 'media') continue;
      if (sourceIndex.has(clip.assetId)) continue;
      const asset = project.assets[clip.assetId];
      const path = asset ? resolveSource(clip.assetId) : null;
      if (!asset || !path) {
        errors.push('clip ' + clip.id + ' references missing asset ' + clip.assetId);
        continue;
      }
      const index = sources.length;
      sourceIndex.set(clip.assetId, index);
      sources.push({ assetId: clip.assetId, path, index, hasVideo: asset.media?.hasVideo ?? false, hasAudio: asset.media?.hasAudio ?? false });
    }
  }

  const video: string[] = [];
  let canvas = '[vb0]';
  video.push('color=c=black:s=' + W + 'x' + H + ':r=' + fpsValue + ':d=' + D.toFixed(3) + ',format=yuv420p' + canvas);

  const captionCues: Array<{ start: number; end: number; text: string }> = [];
  let clipCounter = 0;

  for (const track of sequence.tracks) {
    if (!track.enabled) continue;
    if (track.kind === 'audio') continue;
    const videoClips = track.clips.filter((c): c is Extract<Clip, { kind: 'media' }> => c.enabled && c.kind === 'media');
    let trackCanvas: string | null = null;
    for (const clip of videoClips) {
      const src = sourceIndex.get(clip.assetId);
      if (src === undefined) continue;
      const source = sources[src]!;
      const asset = project.assets[clip.assetId]!;
      if (!source.hasVideo) continue;
      const label = '[vc' + clipCounter + ']';
      clipCounter += 1;
      const chain: string[] = [];
      chain.push('[' + src + ':v]trim=start=' + sec(clip.inPoint) + ':end=' + sec(clip.inPoint + clip.duration * clip.speed) + ',setpts=(PTS-STARTPTS)/' + clip.speed);
      const srcW = asset.media?.width ?? W;
      const srcH = asset.media?.height ?? H;
      if (clip.crop) {
        const cw = Math.max(2, Math.round(srcW * (1 - clip.crop.left - clip.crop.right)));
        const ch = Math.max(2, Math.round(srcH * (1 - clip.crop.top - clip.crop.bottom)));
        const cx = Math.round(srcW * clip.crop.left);
        const cy = Math.round(srcH * clip.crop.top);
        chain.push('crop=' + cw + ':' + ch + ':' + cx + ':' + cy);
      }
      if (clip.transform.rotation !== 0) {
        const rotExpr = 'rotate=' + -clip.transform.rotation + '*PI/180:ow=rotw(' + -clip.transform.rotation + '*PI/180):oh=roth(' + -clip.transform.rotation + '*PI/180)';
        chain.push(rotExpr);
      }
      chain.push('scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease');
      if (clip.opacity < 1) {
        chain.push('format=rgba,colorchannelmixer=aa=' + clip.opacity.toFixed(3));
      }
      if (clip.audio) {
        const fadeIn = clip.audio.fadeInUs / 1_000_000;
        const fadeOut = clip.audio.fadeOutUs / 1_000_000;
        if (fadeIn > 0) chain.push('fade=t=in:st=0:d=' + fadeIn.toFixed(3));
        if (fadeOut > 0) chain.push('fade=t=out:st=' + Math.max(0, clip.duration / 1_000_000 - fadeOut).toFixed(3) + ':d=' + fadeOut.toFixed(3));
      }
      video.push(chain.join(',') + label);

      const cropW = clip.crop ? Math.max(2, Math.round(srcW * (1 - clip.crop.left - clip.crop.right))) : srcW;
      const cropH = clip.crop ? Math.max(2, Math.round(srcH * (1 - clip.crop.top - clip.crop.bottom))) : srcH;
      const { dw, dh } = fitScale(cropW, cropH, clip.transform.rotation, W, H);
      const x = Math.round((W - dw) / 2 + clip.transform.positionX);
      const y = Math.round((H - dh) / 2 + clip.transform.positionY);
      const startS = clip.start / 1_000_000;
      const endS = (clip.start + clip.duration) / 1_000_000;
      const base = trackCanvas ?? canvas;
      const out = '[vt' + track.id.replace(/[^a-zA-Z0-9]/g, '') + clipCounter + ']';
      const between = 'between(t,' + startS.toFixed(4) + ',' + endS.toFixed(4) + ')';
      const overlayFilter = base + label + 'overlay=x=' + x + ':y=' + y + ':enable=' + q(between) + out;
      video.push(overlayFilter);
      trackCanvas = out;
    }
    if (trackCanvas) canvas = trackCanvas;
  }

  let textClipCount = 0;
  for (const track of sequence.tracks) {
    if (!track.enabled) continue;
    for (const clip of track.clips) {
      if (!clip.enabled || clip.kind !== 'text') continue;
      textClipCount += 1;
      const fontSize = Math.round(clip.style.fontSize * (H / 1080));
      const startS = clip.start / 1_000_000;
      const endS = (clip.start + clip.duration) / 1_000_000;
      const out = '[vtext' + textClipCount + ']';
      const between = 'between(t,' + startS.toFixed(4) + ',' + endS.toFixed(4) + ')';
      const filter = canvas + 'drawtext=fontfile=' + q(escapeFilterPath(defaultFontPath())) + ':text=' + q(escapeDrawtext(clip.content)) + ':fontsize=' + fontSize + ':fontcolor=' + clip.style.color + ':x=(w-text_w)*' + clip.style.positionX.toFixed(3) + ':y=(h-text_h)*' + clip.style.positionY.toFixed(3) + ':enable=' + q(between) + out;
      video.push(filter);
      canvas = out;
    }
  }

  const srtPath = options.outputPath.replace(/\.(mp4|mov|mkv|webm)$/i, '') + '.captions.srt';
  const tempFiles: string[] = [srtPath];
  for (const track of sequence.tracks) {
    if (!track.enabled) continue;
    for (const clip of track.clips) {
      if (!clip.enabled || clip.kind !== 'caption') continue;
      for (const segment of clip.segments) {
        captionCues.push({
          start: clip.start + segment.start,
          end: clip.start + segment.end,
          text: segment.text.replace(/\r?\n/g, ' '),
        });
      }
    }
  }
  captionCues.sort((a, b) => a.start - b.start);
  if (captionCues.length > 0) {
    mkdirSync(dirname(srtPath), { recursive: true });
    writeFileSync(srtPath, srtContent(captionCues), 'utf8');
    video.push(canvas + "subtitles='" + escapeFilterPath(srtPath) + "'[vout]");
  } else {
    video.push(canvas + 'null[vout]');
  }

  const audioChains: string[] = [];
  let audioCounter = 0;
  for (const track of sequence.tracks) {
    if (!track.enabled || track.muted) continue;
    for (const clip of track.clips) {
      if (!clip.enabled || clip.kind !== 'media') continue;
      const src = sourceIndex.get(clip.assetId);
      if (src === undefined) continue;
      const source = sources[src]!;
      if (!source.hasAudio) continue;
      const includeAudio = track.kind === 'audio' || clip.audio !== null;
      if (!includeAudio) continue;
      const gain = clip.audio?.gain ?? 1;
      const label = '[ac' + audioCounter + ']';
      audioCounter += 1;
      const parts: string[] = [];
      parts.push('[' + src + ':a]atrim=start=' + sec(clip.inPoint) + ':end=' + sec(clip.inPoint + clip.duration * clip.speed) + ',asetpts=PTS-STARTPTS');
      if (gain !== 1) parts.push('volume=' + gain.toFixed(3));
      if (clip.audio) {
        if (clip.audio.fadeInUs > 0) parts.push('afade=t=in:st=0:d=' + (clip.audio.fadeInUs / 1_000_000).toFixed(3));
        if (clip.audio.fadeOutUs > 0) parts.push('afade=t=out:st=' + Math.max(0, clip.duration / 1_000_000 - clip.audio.fadeOutUs / 1_000_000).toFixed(3) + ':d=' + (clip.audio.fadeOutUs / 1_000_000).toFixed(3));
      }
      parts.push('adelay=' + Math.round(clip.start / 1000) + ':all=1');
      audioChains.push(parts.join(',') + label);
    }
  }
  if (audioChains.length === 0) {
    audioChains.push('anullsrc=r=' + options.sampleRate + ':cl=stereo:d=' + D.toFixed(3) + '[aout]');
  } else {
    const labels = audioChains.map((_, i) => '[ac' + i + ']');
    audioChains.push(labels.join('') + 'amix=inputs=' + labels.length + ':duration=longest:normalize=0[aout]');
  }

  const quality = QUALITY[options.quality ?? 'balanced'];
  const qualityValue = encoder.hardware ? quality.hardware : quality.software;
  const outputArgs: string[] = [
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', encoder.name,
    '-preset', encoder.hardware ? 'p4' : quality.preset,
    encoder.hardware ? '-cq' : '-crf', String(qualityValue),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-r', fpsValue.toFixed(6),
    '-t', D.toFixed(3),
    '-movflags', '+faststart',
    '-y',
    options.outputPath,
  ];

  return {
    options,
    encoder,
    durationUs,
    sources,
    filterComplex: video.concat(audioChains).join(';'),
    outputArgs,
    tempFiles,
    errors,
    warnings,
    textClipCount: textClipCount,
    captionCueCount: captionCues.length,
  };
}

function srtContent(cues: Array<{ start: number; end: number; text: string }>): string {
  const fmt = (us: number): string => {
    const totalMs = Math.round(us / 1000);
    const ms = totalMs % 1000;
    const totalS = Math.floor(totalMs / 1000);
    const s = totalS % 60;
    const m = Math.floor(totalS / 60) % 60;
    const h = Math.floor(totalS / 3600);
    const pad = (n: number, w: number): string => String(n).padStart(w, '0');
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3);
  };
  return cues.map((cue, i) => String(i + 1) + '\n' + fmt(cue.start) + ' --> ' + fmt(cue.end) + '\n' + cue.text + '\n').join('\n');
}