import { ProjectSession, type OvmError, type Project, type TransactionScope } from '@openvideomaker/core';
import type { ClipId } from '@openvideomaker/schema';
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

  exportProject(): string {
    return JSON.stringify({ project: this.project, log: this.#session.exportLog() }, null, 2);
  }

  #emit(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}