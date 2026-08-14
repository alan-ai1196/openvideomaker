import { attachAsrResult, characterDraft, generatedAsset, importedAsset, insertClipAt, mediaClip, planScriptPlacements, ProjectSession, rippleDeleteClip, splitClipAt, syncCaptionsFromTranscript, syncTextClipsFromScript, type OvmError, type Project, type TransactionScope } from '@openvideomaker/core';
import type { MediaInfo } from '@openvideomaker/schema';
import { applyProposal, type EditProposal } from '@openvideomaker/agent';
import { Registry } from '@openvideomaker/registry';
import MODEL_ENTRIES from '@openvideomaker/registry/data.json';
import { newCharacterId, newLineId, newScriptId, newTrackId, type Asset, type AssetId, type CharacterId, type CharacterPatch, type ClipId, type EditPlan, type EditScript, type LineId, type ProjectLog, type ScriptId, type ScriptLinePatch, type SegmentId, type TranscriptId, type VoiceConfig } from '@openvideomaker/schema';
import { getDesktopBridge, type DesktopGenerateProgress, type DesktopGenerateRequest, type DesktopGenerateResult, type StudioDoctorReport } from './desktop';
import { probeBrowserFile } from '../media/browserProbe';
import { MediaCache } from '../media/mediaCache';
import { createWelcomeSession } from './demo';

export interface MutationResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/** One visible unit of long-running work for the Job Center. */
export interface StudioJob {
  id: string;
  kind: 'generate' | 'render' | 'install';
  label: string;
  state: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  /** The main process's own job id, once the first progress event reports it. */
  desktopId?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const REGISTRY = Registry.fromData(MODEL_ENTRIES);

const SAMPLE_SENTENCE = 'Make videos with AI, and keep everything editable.';

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
  /** Runtime-confirmed desktop capabilities (generation is false until the main process confirms it). */
  #desktopRuntime: { localRender: boolean; localGeneration: boolean; localPersistence: boolean; llmPlanner: boolean } | null = null;
  /** Capability+model pairs the local generation service can actually run (from runner manifests). */
  #generationModels: Array<{ capability: string; modelId: string }> = [];
  /** Visible long-running work (the Job Center): generations and renders. */
  #jobs = new Map<string, StudioJob>();
  #jobSeq = 0;
  /** Model ids installed in the local content store (manifest-pinned). */
  #installedModels = new Set<string>();
  /** The probed device graph + recommendations (Device Center). */
  #deviceReport: StudioDoctorReport | null = null;
  /** The project folder the desktop app has open (for the Developer section). */
  #projectDir: string | null = null;

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
   * the local renderer (desktop app or ovm-render CLI) and runs AI
   * generation through the local jobs service (desktop app); it never
   * pretends to run FFmpeg or models inside the page. Generation is only
   * true after the main process confirms its generation service built.
   */
  get capabilities(): { localRender: boolean; localGeneration: boolean; localPersistence: boolean } {
    const bridge = getDesktopBridge();
    return {
      localRender: bridge?.staticCapabilities.localRender ?? false,
      localGeneration: this.#desktopRuntime?.localGeneration ?? false,
      localPersistence: bridge?.staticCapabilities.localPersistence ?? false,
    };
  }

  get localGeneration(): boolean {
    return this.#desktopRuntime?.localGeneration ?? false;
  }

  /** Whether the desktop app has a configured LLM planner for agent edits. */
  get llmPlannerAvailable(): boolean {
    return this.#desktopRuntime?.llmPlanner ?? false;
  }

  /** The probed device graph for the Device Center (desktop only). */
  get deviceReport(): StudioDoctorReport | null {
    return this.#deviceReport;
  }

  /** The desktop project folder (null until the project is saved/opened there). */
  get projectDir(): string | null {
    return this.#projectDir;
  }

  get generationModels(): Array<{ capability: string; modelId: string }> {
    return this.#generationModels;
  }

  /** Whether the local generation service can run this capability at all. */
  generationAvailable(capability: string): boolean {
    return this.localGeneration && this.#generationModels.some((m) => m.capability === capability);
  }

  /** Model ids installed in the local content store. */
  get installedModels(): ReadonlySet<string> {
    return this.#installedModels;
  }

  /** Install a model's files locally (resumable, verified, cancellable, visible in the Job Center). */
  async installModel(modelId: string): Promise<MutationResult> {
    const bridge = getDesktopBridge();
    if (!bridge) return { ok: false, code: 'desktop', message: 'desktop bridge unavailable' };
    const jobId = this.#beginJob('install', 'Install ' + modelId);
    this.#patchJob(jobId, { desktopId: modelId });
    const unsubscribe = bridge.onModelInstallProgress((progress) => {
      if (progress.modelId !== modelId) return;
      const state: StudioJob['state'] = progress.state === 'completed' ? 'completed'
        : progress.state === 'failed' ? 'failed'
          : progress.state === 'cancelled' ? 'cancelled'
            : 'running';
      this.#patchJob(jobId, {
        state,
        progress: progress.totalBytes ? Math.min(1, progress.bytes / progress.totalBytes) : progress.progress,
        stage: progress.stage,
        ...(state === 'completed' || state === 'failed' || state === 'cancelled' ? { finishedAt: new Date().toISOString() } : {}),
      });
    });
    try {
      const result = await bridge.installModel(modelId);
      if (result.state === 'completed') {
        this.#installedModels.add(modelId);
        this.#finishJob(jobId, 'completed');
        return { ok: true };
      }
      this.#finishJob(jobId, result.state === 'cancelled' ? 'cancelled' : 'failed', result.error);
      return { ok: false, code: 'install', message: result.error ?? 'model install did not complete' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#finishJob(jobId, 'failed', message);
      return { ok: false, code: 'install', message };
    } finally {
      unsubscribe();
    }
  }

  /** Visible long-running work for the Job Center, newest first. */
  get jobs(): StudioJob[] {
    return [...this.#jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  #beginJob(kind: StudioJob['kind'], label: string): string {
    const id = 'job-' + ++this.#jobSeq + '-' + Math.random().toString(36).slice(2, 6);
    this.#jobs.set(id, { id, kind, label, state: 'preparing', progress: 0, stage: 'preparing', startedAt: new Date().toISOString() });
    this.#emit();
    return id;
  }

  #patchJob(id: string, patch: Partial<StudioJob>): void {
    const job = this.#jobs.get(id);
    if (!job) return;
    this.#jobs.set(id, { ...job, ...patch });
    this.#emit();
  }

  #finishJob(id: string, state: 'completed' | 'failed' | 'cancelled', error?: string): void {
    this.#patchJob(id, { state, error, finishedAt: new Date().toISOString(), progress: state === 'completed' ? 1 : undefined });
  }

  #adoptGenerationEvent(id: string, event: DesktopGenerateProgress): void {
    const job = this.#jobs.get(id);
    if (!job) return;
    const state: StudioJob['state'] = event.state === 'queued' || event.state === 'installing' || event.state === 'preparing'
      ? 'preparing'
      : event.state === 'completed' ? 'completed'
        : event.state === 'cancelled' ? 'cancelled'
          : event.state === 'failed' ? 'failed'
            : 'running';
    const settled = state === 'completed' || state === 'cancelled' || state === 'failed';
    this.#patchJob(id, {
      desktopId: event.jobId,
      state,
      progress: event.progress,
      stage: event.stage,
      ...(settled ? { finishedAt: new Date().toISOString() } : {}),
    });
  }

  /** Best-effort cancellation of visible work (generation or render). */
  cancelJob(jobId: string): void {
    const job = this.#jobs.get(jobId);
    if (!job || job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return;
    const bridge = getDesktopBridge();
    if (!bridge) return;
    if (job.kind === 'generate') void bridge.cancelGenerate(job.desktopId ?? job.id);
    else if (job.kind === 'render') void bridge.cancelRender(job.desktopId ?? job.id);
    else if (job.desktopId) void bridge.cancelModelInstall(job.desktopId);
  }

  /** Ask the desktop main process what it can actually run; updates capability flags honestly. */
  async refreshDesktopCapabilities(): Promise<void> {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      const [caps, gen, installed] = await Promise.all([bridge.capabilities(), bridge.generationCapabilities(), bridge.installedModels()]);
      this.#desktopRuntime = {
        localRender: caps.localRender === true,
        localGeneration: caps.localGeneration === true,
        localPersistence: caps.localPersistence === true,
        llmPlanner: caps.llmPlanner === true,
      };
      this.#generationModels = Array.isArray(gen.models) ? gen.models : [];
      this.#installedModels = new Set((Array.isArray(installed) ? installed : []).map((i) => i.modelId));
      try {
        this.#deviceReport = await bridge.runDoctor();
      } catch {
        this.#deviceReport = null;
      }
      try {
        this.#projectDir = (await bridge.projectInfo()).dir;
      } catch {
        this.#projectDir = null;
      }
      this.#emit();
    } catch {
      // Bridge vanished or the main process rejected the call; the flags stay honestly false.
    }
  }

  /** Replace the whole session with a loaded project (desktop open, or a file import). */
  loadProject(project: Project, log: ProjectLog): MutationResult {
    try {
      this.#session = ProjectSession.open(project, log);
      this.#selectedClipId = null;
      this.#playheadUs = 0;
      this.#playing = false;
      this.#mediaCache = new MediaCache();
      // Desktop mode: local file assets stream through the ovm-media protocol.
      for (const asset of Object.values(project.assets)) {
        if (asset.source.kind === 'file') this.#mediaCache.registerPath(asset.id, asset.source.path);
      }
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

  async openProjectFromDesktop(): Promise<MutationResult> {
    const bridge = getDesktopBridge();
    if (!bridge) return { ok: false, code: 'desktop', message: 'desktop bridge unavailable' };
    try {
      const loaded = await bridge.openProject();
      if (!loaded) return { ok: false, code: 'cancelled', message: 'open cancelled' };
      const result = this.loadProject(loaded.project, loaded.log);
      this.#projectDir = (await bridge.projectInfo().catch(() => ({ dir: null }))).dir;
      this.#emit();
      return result;
    } catch (err) {
      return { ok: false, code: 'desktop', message: (err as Error).message };
    }
  }

  /** Import media with real file paths through the desktop bridge (probed locally). */
  async importDesktopMedia(): Promise<MutationResult> {
    const bridge = getDesktopBridge();
    if (!bridge) return { ok: false, code: 'desktop', message: 'desktop bridge unavailable' };
    try {
      const items = await bridge.importMedia();
      if (items.length === 0) return { ok: false, code: 'cancelled', message: 'import cancelled' };
      for (const item of items) {
        const asset = importedAsset({ kind: mediaKind(item.media), name: item.name, path: item.path, media: item.media });
        const result = this.mutate((tx) => tx.importAsset({ asset }));
        if (!result.ok) return result;
        this.#mediaCache.registerPath(asset.id, item.path);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, code: 'desktop', message: (err as Error).message };
    }
  }

  /** Render the current project locally (desktop): real ffmpeg through the bridge. */
  async renderDesktop(
    options: { width: number; height: number; quality: 'draft' | 'balanced' | 'high' },
    onProgress?: (progress: { state: string; progress: number }) => void,
  ): Promise<MutationResult & { outputPath?: string }> {
    const bridge = getDesktopBridge();
    if (!bridge) return { ok: false, code: 'desktop', message: 'desktop bridge unavailable' };
    const project = this.#session.project as Project;
    const jobId = this.#beginJob('render', 'Render ' + (project.name || 'video'));
    const unsubscribe = bridge.onRenderProgress((progress) => {
      const state: StudioJob['state'] = progress.state === 'completed' ? 'completed'
        : progress.state === 'failed' ? 'failed'
          : progress.state === 'cancelled' ? 'cancelled'
            : 'running';
      this.#patchJob(jobId, { state, progress: progress.progress, desktopId: progress.jobId });
      onProgress?.(progress);
    });
    try {
      const assetPaths: Record<string, string> = {};
      for (const [id, asset] of Object.entries(project.assets)) {
        if (asset.source.kind === 'file') assetPaths[id] = asset.source.path;
      }
      const result = await bridge.renderProject({
        project,
        assetPaths,
        options: {
          width: options.width,
          height: options.height,
          fps: project.settings.fps ?? { num: 30, den: 1 },
          sampleRate: project.settings.sampleRate ?? 48000,
          quality: options.quality,
          encoderPreference: 'auto',
        },
      });
      if (result.state === 'completed') {
        this.#finishJob(jobId, 'completed');
        return { ok: true, outputPath: result.outputPath };
      }
      if (result.state === 'cancelled') {
        this.#finishJob(jobId, 'cancelled');
        return { ok: false, code: 'cancelled', message: 'render cancelled' };
      }
      this.#finishJob(jobId, 'failed', result.error ?? undefined);
      this.reportError(result.error ?? 'render failed', 'render');
      return { ok: false, code: 'render', message: result.error ?? 'render failed' };
    } catch (err) {
      return { ok: false, code: 'desktop', message: (err as Error).message };
    } finally {
      unsubscribe();
    }
  }

  async saveProjectToDesktop(): Promise<MutationResult> {
    const bridge = getDesktopBridge();
    if (!bridge) return { ok: false, code: 'desktop', message: 'desktop bridge unavailable' };
    try {
      const result = await bridge.saveProject(this.#session.project as Project, this.#session.exportLog());
      if (!result.ok) return { ok: false, code: 'desktop', message: result.reason ?? 'save failed' };
      this.#projectDir = result.dir ?? null;
      this.#emit();
      return { ok: true };
    } catch (err) {
      return { ok: false, code: 'desktop', message: (err as Error).message };
    }
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

  /** Create a script document (script-first editing). */
  createScript(name?: string): ScriptId | null {
    const now = new Date().toISOString();
    const script = { id: newScriptId(), name: name ?? 'New script', lines: [], createdAt: now, updatedAt: now };
    const result = this.mutate((tx) => tx.createScript({ script }));
    return result.ok ? script.id : null;
  }

  addScriptLine(scriptId: ScriptId, text: string): MutationResult {
    return this.mutate((tx) => tx.addScriptLine({ scriptId, line: { id: newLineId(), text } }));
  }

  updateScriptLine(scriptId: ScriptId, lineId: LineId, patch: ScriptLinePatch): MutationResult {
    return this.mutate((tx) => tx.updateScriptLine({ scriptId, lineId, patch }));
  }

  removeScriptLine(scriptId: ScriptId, lineId: LineId): MutationResult {
    return this.mutate((tx) => tx.removeScriptLine({ scriptId, lineId }));
  }

  removeScript(scriptId: ScriptId): MutationResult {
    return this.mutate((tx) => tx.removeScript({ scriptId }));
  }

  /** Place script lines on a 'Script' text track (idempotent, undoable). */
  syncScriptToTimeline(scriptId: ScriptId): void {
    try {
      syncTextClipsFromScript(this.#session, { scriptId });
      this.#lastError = null;
      this.#emit();
    } catch (err) {
      const e = err as OvmError;
      this.#lastError = { code: e.code ?? 'unknown', message: e.message ?? String(err) };
      this.#emit();
    }
  }

  /** Apply a reviewed agent proposal; the edit lands as one undoable transaction. */
  applyAgentProposal(proposal: EditProposal): MutationResult {
    const result = applyProposal(this.#session, proposal);
    if (!result.ok) {
      this.#lastError = { code: 'agent', message: result.errors.join('; ') };
      this.#emit();
      return { ok: false, code: 'agent', message: result.errors.join('; ') };
    }
    this.#lastError = null;
    this.#emit();
    return { ok: true };
  }

  /** Create a persistent, reusable character (library entity). */
  createCharacter(options?: { name?: string }): CharacterId | null {
    const id = newCharacterId();
    const character = characterDraft({
      id,
      name: options?.name ?? 'New Character',
      voice: { provider: 'system.tts', consent: { hasConsent: true } },
    });
    const result = this.mutate((tx) => tx.createCharacter({ character }));
    return result.ok ? character.id : null;
  }

  updateCharacter(characterId: CharacterId, patch: CharacterPatch): MutationResult {
    return this.mutate((tx) => tx.updateCharacter({ characterId, patch }));
  }

  changeCharacterVoice(characterId: CharacterId, voice: VoiceConfig): MutationResult {
    return this.mutate((tx) => tx.changeVoice({ characterId, voice }));
  }

  removeCharacter(characterId: CharacterId): MutationResult {
    return this.mutate((tx) => tx.removeCharacter({ characterId }));
  }

  /** Correct one transcript segment - a typed, undoable project operation. */
  setTranscriptSegmentText(transcriptId: TranscriptId, segmentId: SegmentId, text: string): MutationResult {
    return this.mutate((tx) => tx.setTranscriptSegmentText({ transcriptId, segmentId, text }));
  }

  /** Remove a transcript document and its asset linkage. */
  removeTranscript(transcriptId: TranscriptId): MutationResult {
    return this.mutate((tx) => tx.removeTranscript({ transcriptId }));
  }

  /** Rebuild the caption track from a transcript (idempotent, undoable). */
  syncCaptionsFromTranscript(transcriptId: TranscriptId): void {
    try {
      syncCaptionsFromTranscript(this.#session, { transcriptId });
      this.#lastError = null;
      this.#emit();
    } catch (err) {
      const e = err as OvmError;
      this.#lastError = { code: e.code ?? 'unknown', message: e.message ?? String(err) };
      this.#emit();
    }
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
    return this.placeAssetOnTimeline(assetId, this.playheadUs);
  }

  /** Place an asset on a compatible track at an explicit time (insert edit; creates the track if needed). */
  placeAssetOnTimeline(assetId: AssetId, atUs: number): MutationResult {
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
    const clip = mediaClip({ trackId: track.id, assetId, start: Math.max(0, Math.round(atUs)), duration: durationUs });
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

  // ------------------------------------------------------------------
  // Local AI generation (desktop). Requests go through the same
  // GenerationRunner the SDK/CLI use; results land in the project ONLY
  // through the typed operation layer, with full provenance.
  // ------------------------------------------------------------------

  async #runDesktopGenerate(request: DesktopGenerateRequest, jobLabel: string, onProgress?: (progress: DesktopGenerateProgress) => void): Promise<DesktopGenerateResult> {
    const bridge = getDesktopBridge();
    if (!bridge) throw new Error('desktop bridge unavailable');
    const jobId = this.#beginJob('generate', jobLabel);
    const unsubscribe = bridge.onGenerateProgress((progress) => {
      this.#adoptGenerationEvent(jobId, progress);
      onProgress?.(progress);
    });
    try {
      const result = await bridge.generate(request);
      if (result.state === 'completed') this.#finishJob(jobId, 'completed');
      else if (result.state === 'cancelled') this.#finishJob(jobId, 'cancelled');
      else this.#finishJob(jobId, 'failed', result.error ?? undefined);
      return result;
    } catch (err) {
      this.#finishJob(jobId, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      unsubscribe();
    }
  }

  /** Resolve a TTS voice file from the model's registry file manifest (data-driven, never hardcoded per model). */
  #resolveVoiceFileKey(modelId: string, voiceId?: string): string {
    const entry = REGISTRY.byId(modelId);
    const candidates = (entry?.files ?? []).map((f) => f.path).filter((p) => p.endsWith('.pt'));
    if (voiceId) {
      const requested = 'voices/' + voiceId + '.pt';
      if (candidates.includes(requested)) return requested;
    }
    return candidates.find((p) => p.includes('af_heart')) ?? candidates[0] ?? 'voices/af_heart.pt';
  }

  #pickAsrModel(language?: string): string | null {
    const asr = this.#generationModels.filter((m) => m.capability === 'audio.asr').map((m) => m.modelId);
    if (language === 'zh') return asr.find((id) => id.includes('paraformer')) ?? asr[0] ?? null;
    return asr.find((id) => id.includes('whisper')) ?? asr[0] ?? null;
  }

  /** Generate speech locally and import it as a provenance-carrying audio asset (optionally placed at an explicit time). */
  async generateSpeech(options: {
    modelId: string;
    text: string;
    voiceId?: string;
    name?: string;
    device?: 'cuda' | 'cpu';
    placeOnTimeline?: boolean;
    placeAtUs?: number;
    onProgress?: (progress: number, stage: string) => void;
  }): Promise<MutationResult & { assetId?: AssetId }> {
    try {
      const result = await this.#runDesktopGenerate(
        {
          capability: 'audio.tts',
          modelId: options.modelId,
          settings: { text: options.text },
          modelInputs: { voice: this.#resolveVoiceFileKey(options.modelId, options.voiceId) },
          device: options.device ?? 'cpu',
          provenanceInputs: [{ kind: 'text', role: 'script', text: options.text }],
        },
        options.name ?? 'Generate speech',
        (p) => options.onProgress?.(p.progress, p.stage),
      );
      if (result.state !== 'completed' || !result.provenance) {
        const message = result.error ?? 'generation did not complete';
        this.reportError(message, 'generation');
        return { ok: false, code: 'generation', message };
      }
      const output = result.outputs.audio;
      if (!output) {
        this.reportError('generation produced no audio', 'generation');
        return { ok: false, code: 'generation', message: 'generation produced no audio' };
      }
      const asset = generatedAsset({
        kind: 'audio',
        name: options.name ?? 'Generated speech',
        source: { kind: 'file', path: output.path },
        media: output.media,
        capability: result.provenance.capability,
        model: result.provenance.model,
        runner: result.provenance.runner,
        settings: result.provenance.settings,
        inputs: result.provenance.inputs,
        regenerable: result.provenance.regenerable,
        device: result.provenance.device,
        generatedAt: result.provenance.generatedAt,
      });
      const imported = this.mutate((tx) => tx.importAsset({ asset }));
      if (!imported.ok) return imported;
      this.#mediaCache.registerPath(asset.id, output.path);
      if (options.placeOnTimeline) this.placeAssetOnTimeline(asset.id, options.placeAtUs ?? this.playheadUs);
      return { ok: true, assetId: asset.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.reportError(message, 'generation');
      return { ok: false, code: 'generation', message };
    }
  }

  /** Generate a voiceover line for a character and place it on the timeline. */
  async generateVoiceover(characterId: CharacterId, text: string, onProgress?: (progress: number, stage: string) => void): Promise<MutationResult & { assetId?: AssetId }> {
    const character = this.project.characters[characterId];
    if (!character) return { ok: false, code: 'op.not-found', message: 'character not found' };
    const modelId = character.voice.modelId ?? character.voice.provider;
    if (!this.#generationModels.some((m) => m.modelId === modelId && m.capability === 'audio.tts')) {
      return { ok: false, code: 'generation', message: 'this character has no local TTS provider' };
    }
    return this.generateSpeech({
      modelId,
      text,
      voiceId: character.voice.voiceId,
      name: character.name + ' voiceover',
      placeOnTimeline: true,
      onProgress,
    });
  }


  /**
   * Generate speech for one script line: planScriptPlacements decides
   * WHERE the audio lands (the same plan the text sync uses), and the
   * real speech duration becomes the line's authoritative timing, so
   * text clips and audio can never disagree.
   */
  async generateScriptLineSpeech(scriptId: ScriptId, lineId: LineId, onProgress?: (progress: number, stage: string) => void): Promise<MutationResult & { assetId?: AssetId }> {
    const script = this.project.scripts[scriptId];
    if (!script) return { ok: false, code: 'op.not-found', message: 'script not found' };
    const lineIndex = script.lines.findIndex((l) => l.id === lineId);
    const line = lineIndex >= 0 ? script.lines[lineIndex] : undefined;
    if (!line) return { ok: false, code: 'op.not-found', message: 'line not found' };
    const character = line.characterId ? this.project.characters[line.characterId] : undefined;
    const modelId = character?.voice.modelId ?? character?.voice.provider;
    if (!modelId || !this.#generationModels.some((m) => m.modelId === modelId && m.capability === 'audio.tts')) {
      return { ok: false, code: 'generation', message: 'link this line to a character with a local TTS provider first' };
    }
    const placement = planScriptPlacements(script).find((p) => p.lineId === lineId);
    if (!placement) return { ok: false, code: 'generation', message: 'the line has no text to speak' };
    const speech = await this.generateSpeech({
      modelId,
      text: line.text,
      voiceId: line.voiceId ?? character?.voice.voiceId,
      name: (character?.name ?? 'voice') + ' line ' + (lineIndex + 1),
      placeOnTimeline: true,
      placeAtUs: placement.start,
      onProgress,
    });
    if (!speech.ok || !speech.assetId) return speech;
    // The real speech becomes the authoritative timing for this line, so
    // re-syncing text clips follows the spoken duration.
    const asset = this.project.assets[speech.assetId];
    const durationUs = asset?.media?.durationUs;
    this.mutate((tx) => tx.updateScriptLine({
      scriptId,
      lineId,
      patch: { startUs: placement.start, ...(durationUs ? { durationUs: Math.round(durationUs) } : {}) },
    }));
    return speech;
  }
  /** Transcribe a local media asset: durable transcript document + caption clips through core commands. */
  async transcribeAsset(assetId: AssetId, options?: { language?: string; onProgress?: (progress: number, stage: string) => void }): Promise<MutationResult & { transcriptId?: TranscriptId }> {
    const asset = this.project.assets[assetId];
    if (!asset) return { ok: false, code: 'op.not-found', message: 'asset not found' };
    if (asset.source.kind !== 'file') return { ok: false, code: 'generation', message: 'this asset has no local file to transcribe' };
    const modelId = this.#pickAsrModel(options?.language);
    if (!modelId) return { ok: false, code: 'generation', message: 'no local ASR model is available' };
    try {
      const result = await this.#runDesktopGenerate(
        {
          capability: 'audio.asr',
          modelId,
          inputs: { audio: { path: asset.source.path } },
          settings: options?.language ? { language: options.language } : {},
          device: 'cuda',
          provenanceInputs: [{ kind: 'audio', role: 'source', assetId }],
        },
        'Transcribe ' + asset.name,
        (p) => options?.onProgress?.(p.progress, p.stage),
      );
      if (result.state !== 'completed' || !result.provenance) {
        const message = result.error ?? 'transcription did not complete';
        this.reportError(message, 'generation');
        return { ok: false, code: 'generation', message };
      }
      const transcriptOutput = result.outputs.transcript;
      const parsed = transcriptOutput?.json as { language?: string; segments?: unknown } | undefined;
      if (!parsed || !Array.isArray(parsed.segments)) {
        this.reportError('transcription produced no transcript', 'generation');
        return { ok: false, code: 'generation', message: 'transcription produced no transcript' };
      }
      const segments = parsed.segments.map((segment, index) => {
        const s = segment as { text?: unknown; startMs?: unknown; endMs?: unknown };
        if (typeof s.text !== 'string' || typeof s.startMs !== 'number' || typeof s.endMs !== 'number') {
          throw new Error('malformed transcript segment ' + index);
        }
        return { text: s.text, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) };
      });
      const attach = attachAsrResult(this.#session, {
        audioAssetId: assetId,
        language: typeof parsed.language === 'string' ? parsed.language : options?.language,
        segments,
        provenance: { ...result.provenance, inputs: [{ kind: 'audio', role: 'source', assetId }] },
      });
      const srt = result.outputs.srt;
      if (srt) {
        const srtAsset = generatedAsset({
          kind: 'subtitle',
          name: asset.name + ' subtitles',
          source: { kind: 'file', path: srt.path },
          capability: result.provenance.capability,
          model: result.provenance.model,
          runner: result.provenance.runner,
          settings: result.provenance.settings,
          inputs: result.provenance.inputs,
          regenerable: result.provenance.regenerable,
          device: result.provenance.device,
          generatedAt: result.provenance.generatedAt,
        });
        this.mutate((tx) => tx.importAsset({ asset: srtAsset }));
        this.#mediaCache.registerPath(srtAsset.id, srt.path);
      }
      this.#emit();
      return { ok: true, transcriptId: attach.transcriptId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.reportError(message, 'generation');
      return { ok: false, code: 'generation', message };
    }
  }


  /**
   * Redub: lip-sync the selected talking-head clip to a replacement audio
   * asset (avatar.lip_sync). The synced video lands as a provenance-carrying
   * asset on a NEW video track at the source clip's start, so the original
   * stays intact for comparison - everything remains editable.
   */
  async lipSyncClip(clipId: ClipId, audioAssetId: AssetId, onProgress?: (progress: number, stage: string) => void): Promise<MutationResult & { assetId?: AssetId }> {
    const sequence = this.activeSequence();
    if (!sequence) return { ok: false, code: 'op.not-found', message: 'no active sequence' };
    let sourceClip: { assetId: AssetId; start: number } | undefined;
    for (const track of sequence.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip?.kind === 'media') { sourceClip = { assetId: clip.assetId, start: clip.start }; break; }
      if (clip) return { ok: false, code: 'generation', message: 'lip sync applies to media clips' };
    }
    if (!sourceClip) return { ok: false, code: 'op.not-found', message: 'clip not found' };
    const videoAsset = this.project.assets[sourceClip.assetId];
    const audioAsset = this.project.assets[audioAssetId];
    if (!videoAsset || videoAsset.source.kind !== 'file') {
      return { ok: false, code: 'generation', message: 'this clip has no local video file to lip-sync' };
    }
    if (!audioAsset || audioAsset.source.kind !== 'file') {
      return { ok: false, code: 'generation', message: 'choose an audio asset with a local file' };
    }
    const modelId = this.#generationModels.find((m) => m.capability === 'avatar.lip_sync')?.modelId;
    if (!modelId) return { ok: false, code: 'generation', message: 'no local lip-sync model is available' };
    try {
      const result = await this.#runDesktopGenerate(
        {
          capability: 'avatar.lip_sync',
          modelId,
          inputs: { video: { path: videoAsset.source.path }, audio: { path: audioAsset.source.path } },
          device: 'cuda',
          provenanceInputs: [
            { kind: 'asset', role: 'source', assetId: sourceClip.assetId },
            { kind: 'audio', role: 'replacement', assetId: audioAssetId },
          ],
        },
        'Lip sync ' + videoAsset.name,
        (p) => onProgress?.(p.progress, p.stage),
      );
      if (result.state !== 'completed' || !result.provenance) {
        const message = result.error ?? 'lip sync did not complete';
        this.reportError(message, 'generation');
        return { ok: false, code: 'generation', message };
      }
      const output = result.outputs.video;
      if (!output?.media) {
        this.reportError('lip sync produced no playable video', 'generation');
        return { ok: false, code: 'generation', message: 'lip sync produced no playable video' };
      }
      const asset = generatedAsset({
        kind: 'video',
        name: videoAsset.name + ' (lip sync)',
        source: { kind: 'file', path: output.path },
        media: output.media,
        capability: result.provenance.capability,
        model: result.provenance.model,
        runner: result.provenance.runner,
        settings: result.provenance.settings,
        inputs: result.provenance.inputs,
        regenerable: result.provenance.regenerable,
        device: result.provenance.device,
        generatedAt: result.provenance.generatedAt,
      });
      const imported = this.mutate((tx) => tx.importAsset({ asset }));
      if (!imported.ok) return imported;
      this.#mediaCache.registerPath(asset.id, output.path);
      // A new video track keeps the original and the synced version side by side.
      const durationUs = Math.max(1_000_000, output.media.durationUs ?? videoAsset.media?.durationUs ?? 5_000_000);
      const trackId = newTrackId();
      const placed = this.mutate((tx) => {
        tx.createTrack({ sequenceId: sequence.id, trackId, kind: 'video', name: 'Lip sync' });
        tx.insertClip({ sequenceId: sequence.id, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: sourceClip.start, duration: durationUs }) });
      });
      if (!placed.ok) {
        // The asset is imported and usable even when timeline placement
        // failed; surface the placement problem instead of hiding it.
        console.error('lip-sync placement failed: ' + (placed.message ?? 'unknown') + ' (' + (placed.code ?? 'no code') + ')');
        this.reportError('synced video imported, but placing it failed: ' + (placed.message ?? 'unknown'), 'generation');
      }
      return { ok: true, assetId: asset.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.reportError(message, 'generation');
      return { ok: false, code: 'generation', message };
    }
  }
  /** Ask the desktop's configured LLM planner for an agent edit (validated + compiled against THIS project). */
  async planWithLlm(goal: string): Promise<{ ok: true; plan: EditPlan; script: EditScript } | { ok: false; message: string }> {
    const bridge = getDesktopBridge();
    if (!bridge) return { ok: false, message: 'desktop bridge unavailable' };
    try {
      const result = await bridge.agentPlan(goal, this.#session.project as Project, this.#session.exportLog());
      if (result.ok) return { ok: true, plan: result.plan, script: result.script };
      return { ok: false, message: result.message };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** A short local TTS sample for a model (the Model Center Generate affordance). */
  async generateModelSample(modelId: string, onProgress?: (progress: number, stage: string) => void): Promise<MutationResult & { assetId?: AssetId }> {
    const entry = REGISTRY.byId(modelId);
    return this.generateSpeech({
      modelId,
      text: SAMPLE_SENTENCE,
      name: (entry?.displayName ?? modelId) + ' sample',
      placeOnTimeline: true,
      onProgress,
    });
  }

  #emit(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}/** Map a probed media result to the asset kind the project stores. */
function mediaKind(media: MediaInfo): Asset['kind'] {
  if (media.hasVideo) return 'video';
  if (media.hasAudio) return 'audio';
  return 'image';
}
