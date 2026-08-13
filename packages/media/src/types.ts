import type { MediaInfo } from '@openvideomaker/schema';

/** Errors from media tooling: stable codes, human messages. */
export class MediaError extends Error {
  readonly code: 'probe.failed' | 'probe.not-found' | 'probe.invalid-output' | 'tool.missing' | 'io.failed';
  readonly command?: string;
  constructor(code: MediaError['code'], message: string, options?: { command?: string; cause?: unknown }) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
    this.command = options?.command;
    if (options?.cause !== undefined) this.cause = options.cause as Error;
  }
}

/** Complete probe result: probed MediaInfo plus the source kind used. */
export interface ProbeResult {
  media: MediaInfo;
  /** True when the source carried a video stream (width/height present). */
  kind: 'video' | 'audio' | 'image';
}

export interface ThumbnailOptions {
  /** Frame width in pixels (height scales). Default 192. */
  width?: number;
  /** Number of thumbnails. Default: min(12, ceil(duration/1.5s)). */
  count?: number;
  /** Quality for jpg frames (2-31, lower is better). Default 4. */
  quality?: number;
}

export interface WaveformOptions {
  /** Peaks per second of audio. Default 24. */
  peaksPerSecond?: number;
}

export interface Waveform {
  peaks: number[];
  /** Peak density used, per second. */
  peaksPerSecond: number;
  durationUs: number;
}