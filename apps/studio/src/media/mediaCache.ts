import type { AssetId, RationalFps } from '@openvideomaker/schema';
import { extractBrowserThumbnails } from './browserThumbs';
import { extractBrowserWaveform } from './browserWaveform';

interface CachedMedia {
  objectUrl?: string;
  thumbnails?: string[];
  peaks?: number[];
  peaksPerSecond?: number;
}

/**
 * Session-scoped media cache: object URLs, filmstrip thumbnails and
 * waveform peaks for imported assets. This is runtime presentation data;
 * it is deliberately NOT part of the durable project state. Desktop mode
 * replaces the browser extractors with ffmpeg-backed ones.
 */
export class MediaCache {
  #entries = new Map<AssetId, CachedMedia>();
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): number => this.#entries.size;

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  get(assetId: AssetId): CachedMedia {
    return this.#entries.get(assetId) ?? {};
  }

  /**
   * Desktop mode: bind an asset to a local file path through the
   * ovm-media:// protocol. The main process only serves paths the user
   * imported, generated, rendered or opened, so this is presentation
   * convenience over an allow-list, never filesystem access.
   */
  registerPath(assetId: AssetId, path: string): void {
    const entry = this.#entries.get(assetId) ?? {};
    entry.objectUrl = 'ovm-media://local/' + encodeURIComponent(path);
    this.#entries.set(assetId, entry);
    this.#emit();
  }

  registerFile(assetId: AssetId, file: File, media: { hasVideo: boolean; hasAudio: boolean; durationUs: number }): void {
    const entry: CachedMedia = { objectUrl: URL.createObjectURL(file) };
    this.#entries.set(assetId, entry);
    this.#emit();
    const tasks: Promise<void>[] = [];
    if (media.hasVideo && media.durationUs > 0) {
      const count = Math.max(2, Math.min(Math.ceil((media.durationUs / 1_000_000) / 1.5), 10));
      tasks.push(
        extractBrowserThumbnails(file, count, 160)
          .then((thumbnails) => {
            entry.thumbnails = thumbnails;
            this.#emit();
          })
          .catch(() => undefined),
      );
    }
    if ((media.hasAudio || file.type.startsWith('video/')) && media.durationUs > 0) {
      tasks.push(
        extractBrowserWaveform(file, 20)
          .then((wave) => {
            entry.peaks = wave.peaks;
            entry.peaksPerSecond = wave.peaksPerSecond;
            this.#emit();
          })
          .catch(() => undefined),
      );
    }
    void Promise.all(tasks);
  }
}

export const DEFAULT_FPS: RationalFps = { num: 30, den: 1 };