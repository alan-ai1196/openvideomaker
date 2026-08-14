import type { GenerationInput, GenerationProvenance, MediaInfo, Project, ProjectLog } from '@openvideomaker/schema';

/** Render payload shared by the desktop bridge (typed at runtime only). */
export interface DesktopRenderRequest {
  project: Project;
  assetPaths: Record<string, string>;
  outputPath?: string;
  options: {
    width: number;
    height: number;
    fps: { num: number; den: number };
    sampleRate: number;
    quality: 'draft' | 'balanced' | 'high';
    encoderPreference: 'auto' | 'hardware' | 'software';
  };
}

/** Capability-first generation request, validated in the main process. */
export interface DesktopGenerateRequest {
  capability: string;
  modelId: string;
  settings?: Record<string, unknown>;
  inputs?: Record<string, { path: string }>;
  /** Model-owned input files: adapter key -> path in the entry's file manifest. */
  modelInputs?: Record<string, string>;
  device?: 'cuda' | 'cpu' | 'mlx' | 'rocm';
  provenanceInputs?: GenerationInput[];
}

export interface DesktopGenerateProgress {
  jobId: string;
  state: string;
  stage: string;
  progress: number;
  bytes: number;
  totalBytes: number | null;
}

export interface DesktopGenerateResult {
  jobId: string;
  state: string;
  outputs: Record<string, { path: string; sha256?: string; media?: MediaInfo; json?: unknown }>;
  metadata: Record<string, unknown>;
  provenance: GenerationProvenance | null;
  error: string | null;
}

export interface DesktopRuntimeCapabilities {
  desktop: boolean;
  localPersistence: boolean;
  localRender: boolean;
  localGeneration: boolean;
}

/**
 * The desktop bridge is exposed by the Electron preload as a NARROW
 * typed object. In the browser it simply does not exist - capability
 * detection changes available options without changing semantics.
 * The static capabilities describe what the shell ships; the runtime
 * capabilities() call is authoritative (e.g. generation stays false
 * when the local generation service cannot build).
 */
export interface StudioDesktopBridge {
  staticCapabilities: DesktopRuntimeCapabilities;
  capabilities(): Promise<DesktopRuntimeCapabilities>;
  openProject(): Promise<{ project: Project; log: ProjectLog } | null>;
  saveProject(project: Project, log: ProjectLog): Promise<{ ok: boolean; appended?: number; dir?: string; reason?: string }>;
  runDoctor(): Promise<unknown>;
  importMedia(): Promise<Array<{ path: string; name: string; media: MediaInfo }>>;
  renderProject(request: DesktopRenderRequest): Promise<{ state: string; outputPath?: string; error: string | null; jobId?: string }>;
  onRenderProgress(listener: (progress: { jobId?: string; state: string; progress: number }) => void): () => void;
  cancelRender(jobId: string): Promise<{ ok: boolean }>;
  installedModels(): Promise<Array<{ modelId: string; revision: string; installedAt: string }>>;
  installModel(modelId: string): Promise<{ state: string; error?: string }>;
  cancelModelInstall(modelId: string): Promise<{ ok: boolean }>;
  onModelInstallProgress(listener: (progress: { modelId: string; state: string; stage: string; progress: number; bytes: number; totalBytes: number | null }) => void): () => void;
  generate(request: DesktopGenerateRequest): Promise<DesktopGenerateResult>;
  cancelGenerate(jobId: string): Promise<{ ok: boolean }>;
  onGenerateProgress(listener: (progress: DesktopGenerateProgress) => void): () => void;
  generationCapabilities(): Promise<{ models: Array<{ capability: string; modelId: string }> }>;
}

declare global {
  interface Window {
    ovm?: StudioDesktopBridge;
  }
}

export function getDesktopBridge(): StudioDesktopBridge | null {
  return typeof window !== 'undefined' && window.ovm ? window.ovm : null;
}
