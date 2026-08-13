import { importedAsset, insertClipAt, mediaClip, ProjectSession, rippleDeleteClip, splitClipAt, type OvmError, type Project, type TransactionScope } from '@openvideomaker/core';
import { newTrackId, type AssetId, type ClipId } from '@openvideomaker/schema';
import { probeBrowserFile } from '../media/browserProbe';
import { MediaCache } from '../media/mediaCache';
import { createWelcomeSession } from './demo';

export interface MutationResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/**
 * UI-agnostic Studio state: wraps one ProjectSession and exposes
 * selection, playhead, playback clock, zoom and history. React binds to
 * it through useSyncExternalStore; every mutation goes through the
 * session's transaction API - the same operation layer MCP/SDK/CLI use.
 */
export class StudioController {
  #session: ProjectSession;
  #listeners = new Set<() => void>();
  #version = 0;
  #selectedClipId: ClipId | null = null;
  #playheadUs = 0;
  #playing = false;
  #rafId: number | null = null;
  #lastTick = 0;
  #zoomPxPerSec = 48;
  #lastError: { code: string; message: string } | null = null;
  #mediaCache = new MediaCache();

  private constructor(session: ProjectSession) {
    this.#session = session;
  }

  static welcome(): StudioController {
    return new StudioController(createWelcomeSession());
  }

  static open(project: Parameters<typeof ProjectSession.open>[0], log: Parameters<typeof ProjectSession.open>[1]): StudioController {
    return new StudioController(ProjectSession.open(project, log));
  }

  get version(): number {
    return this.#version;
  }

  get project(): Readonly<Project> {
    return this.#session.project;
  }

  get canUndo(): boolean {
    return this.#session.canUndo;
  }

  get canRedo(): boolean {
    return this.#session.canRedo;
  }

  get checkpoint(): number {
    return this.#session.checkpoint;
  }

  get selectedClipId(): ClipId | null {
    return this.#selectedClipId;
  }

  get playheadUs(): number {
    return this.#playheadUs;
  }

  get playing(): boolean {
    return this.#playing;
  }

  get zoomPxPerSec(): number {
    return this.#zoomPxPerSec;
  }

  get lastError(): { code: string; message: string } | null {
    return this.#lastError;
  }

  /** Runtime presentation cache: object URLs, thumbnails, waveforms. */
  get mediaCache(): MediaCache {
    return this.#mediaCache;
  }

  /**
   * What this runtime can actually do. The browser Studio renders through
   * the local renderer (desktop app or ovm-render CLI); it never pretends
   * to run FFmpeg inside the page.
   */
  get capabilities(): { localRender: boolean } {
    return { localRender: false };
  }

  clearError(): void {
    if (this.#lastError) {
      this.#lastError = null;
      this.#emit();
    }
  }

  /** Surface an external failure (e.g. a project file that will not open). */
  reportError(message: string, code = 'external'): void {
    this.#lastError = { code, message };
    this.#emit();
  }

  /** Total timeline duration of the active sequence (µs). */
  get sequenceDurationUs(): number {
    const sequence = this.activeSequence();
    if (!sequence) return 0;
    let end = 0;
    for (const track of sequence.tracks) {
      for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
    }
    return end;
  }

  activeSequence() {
    const project = this.project;
    const id = project.activeSequenceId ?? Object.keys(project.sequences)[0];
    return id ? project.sequences[id] : undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): number => this.#version;

  selectClip(clipId: ClipId | null): void {
    this.#selectedClipId = clipId;
    this.#emit();
  }

  setPlayhead(us: number): void {
    const next = Math.max(0, Math.min(us, this.sequenceDurationUs));
    if (next !== this.#playheadUs) {
      this.#playheadUs = next;
      this.#emit();
    }
  }

  setZoom(pxPerSec: number): void {
    this.#zoomPxPerSec = Math.max(4, Math.min(pxPerSec, 400));
    this.#emit();
  }

  zoomBy(factor: number): void {
    this.setZoom(this.#zoomPxPerSec * factor);
  }

  togglePlay(): void {
    if (this.#playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.#playing) return;
    if (this.#playheadUs >= this.sequenceDurationUs) this.#playheadUs = 0;
    this.#playing = true;
    this.#lastTick = performance.now();
    const tick = (now: number): void => {
      const deltaUs = (now - this.#lastTick) * 1000;
      this.#lastTick = now;
      const next = this.#playheadUs + deltaUs;
      if (next >= this.sequenceDurationUs) {
        this.#playheadUs = this.sequenceDurationUs;
        this.#playing = false;
        this.#rafId = null;
      } else {
        this.#playheadUs = next;
        this.#rafId = requestAnimationFrame(tick);
      }
      this.#emit();
    };
    this.#rafId = requestAnimationFrame(tick);
    this.#emit();
  }

  pause(): void {
    this.#playing = false;
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    this.#emit();
  }

  undo(): void {
    if (this.#session.undo()) this.#emit();
  }

  redo(): void {
    if (this.#session.redo()) this.#emit();
  }

  /**
   * Run a transaction through the authoritative operation layer.
   * Failures are captured and surfaced to the UI instead of crashing it.
   */
  mutate(fn: (tx: TransactionScope) => void): MutationResult {
    try {
      this.#session.transaction(fn);
      this.#lastError = null;
      this.#emit();
      return { ok: true };
    } catch (err) {
      const e = err as OvmError;
      this.#lastError = { code: e.code ?? 'unknown', message: e.message ?? String(err) };
      this.#emit();
      return { ok: false, code: e.code, message: e.message };
    }
  }

  /** Probe a dropped/picked file and import it as an asset. */
  async importMediaFile(file: File): Promise<MutationResult> {
    try {
      const { media, kind } = await probeBrowserFile(file);
      const asset = importedAsset({
        kind,
        name: file.name,
        path: 'browser://' + file.name,
        source: { kind: 'cas', ref: 'browser:' + file.size + ':' + file.lastModified },
        media,
      });
      const result = this.mutate((tx) => tx.importAsset({ asset }));
      if (result.ok) {
        this.#mediaCache.registerFile(asset.id, file, { hasVideo: media.hasVideo, hasAudio: media.hasAudio, durationUs: media.durationUs });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.reportError(message, 'media.import');
      return { ok: false, code: 'media.import', message };
    }
  }

  /** Place an asset on a compatible track at the playhead (creating the track if needed). */
  addAssetToTimeline(assetId: AssetId): MutationResult {
    const project = this.project;
    const asset = project.assets[assetId];
    if (!asset) return { ok: false, code: 'op.not-found', message: 'asset not found' };
    const sequence = this.activeSequence();
    if (!sequence) return { ok: false, code: 'op.not-found', message: 'no active sequence' };
    const isAudio = asset.kind === 'audio' || Boolean(asset.media?.hasAudio && !asset.media?.hasVideo);
    const trackKind = isAudio ? 'audio' : 'video';
    const existing = sequence.tracks.find((track) => track.kind === trackKind);
    const sequenceId = sequence.id;
    const durationUs = asset.kind === 'image'
      ? 3_000_000
      : Math.max(1_000_000, asset.media?.durationUs ?? 5_000_000);
    let track = existing;
    if (!track) {
      const newId = newTrackId();
      const created = this.mutate((tx) => tx.createTrack({ sequenceId, trackId: newId, kind: trackKind }));
      if (!created.ok) return created;
      track = this.activeSequence()?.tracks.find((t) => t.id === newId);
    }
    if (!track) return { ok: false, code: 'op.not-found', message: 'track missing' };
    const clip = mediaClip({ trackId: track.id, assetId, start: this.playheadUs, duration: durationUs });
    const ok = insertClipAt(this.#session, sequenceId, track.id, clip);
    this.#emit();
    return ok ? { ok: true } : { ok: false, code: 'op.validation', message: 'could not place clip on the timeline' };
  }

  /** Split the selected clip at the playhead; keeps the right half selected. */
  splitSelectedAtPlayhead(): boolean {
    const clipId = this.#selectedClipId;
    if (!clipId) return false;
    const sequence = this.activeSequence();
    if (!sequence) return false;
    const rightId = splitClipAt(this.#session, sequence.id, clipId, this.#playheadUs);
    if (rightId) {
      this.#selectedClipId = rightId;
      this.#emit();
      return true;
    }
    return false;
  }

  /** Ripple-delete the selected clip and clear the selection. */
  rippleDeleteSelected(): boolean {
    const clipId = this.#selectedClipId;
    if (!clipId) return false;
    const sequence = this.activeSequence();
    if (!sequence) return false;
    if (rippleDeleteClip(this.#session, sequence.id, clipId)) {
      this.#selectedClipId = null;
      this.#emit();
      return true;
    }
    return false;
  }

  exportProject(): string {
    return JSON.stringify({ project: this.project, log: this.#session.exportLog() }, null, 2);
  }

  #emit(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}