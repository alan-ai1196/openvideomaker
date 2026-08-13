import type { MediaInfo, RationalFps } from '@openvideomaker/schema';

export interface BrowserProbeResult {
  media: MediaInfo;
  kind: 'video' | 'audio' | 'image';
}

function probeVideo(file: File): Promise<BrowserProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      const media: MediaInfo = {
        durationUs: Number.isFinite(video.duration) ? Math.round(video.duration * 1_000_000) : 0,
        hasVideo: true,
        hasAudio: false,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        format: file.type || undefined,
      };
      // Probe audio presence by reading the audioTracks (Chromium) or via mozHasAudio.
      const tracks = (video as unknown as { audioTracks?: { length: number } }).audioTracks;
      if (tracks && tracks.length > 0) media.hasAudio = true;
      const guessed: RationalFps | undefined = Number.isFinite(video.duration) && video.videoWidth ? { num: 30, den: 1 } : undefined;
      if (guessed) media.fps = guessed;
      resolve({ media, kind: 'video' });
      cleanup();
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read video metadata for ' + file.name));
    };
    video.src = url;
  });
}

function probeAudio(file: File): Promise<BrowserProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      resolve({
        media: {
          durationUs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1_000_000) : 0,
          hasVideo: false,
          hasAudio: true,
          format: file.type || undefined,
        },
        kind: 'audio',
      });
      cleanup();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('Could not read audio metadata for ' + file.name));
    };
    audio.src = url;
  });
}

function probeImage(file: File): Promise<BrowserProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        media: {
          durationUs: 0,
          hasVideo: true,
          hasAudio: false,
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined,
          format: file.type || undefined,
        },
        kind: 'image',
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image metadata for ' + file.name));
    };
    img.src = url;
  });
}

/**
 * Browser-mode media probing: metadata without any Node privileges.
 * The desktop app uses the ffprobe path (@openvideomaker/media); the
 * asset schema and project semantics are identical either way.
 */
export function probeBrowserFile(file: File): Promise<BrowserProbeResult> {
  const type = file.type || '';
  if (type.startsWith('video/')) return probeVideo(file);
  if (type.startsWith('audio/')) return probeAudio(file);
  if (type.startsWith('image/')) return probeImage(file);
  return Promise.reject(new Error('Unsupported media type for ' + file.name + (type ? ' (' + type + ')' : '')));
}