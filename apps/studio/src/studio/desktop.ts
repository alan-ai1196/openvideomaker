import type { EditPlan, EditScript, GenerationInput, GenerationProvenance, MediaInfo, Project, ProjectLog } from '@openvideomaker/schema';

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

/** Media intelligence analysis, as the Studio consumes it. */
export interface StudioMediaAnalysis {
  durationUs: number;
  shots: Array<{ startUs: number; endUs: number }>;
  keyframeAtUs: number[];
  audioRegions: Array<{ startUs: number; endUs: number; silent: boolean }>;
  /** Level 2: per-shot mean inter-frame luma difference (0-255). */
  motionPerShot?: number[];
}


/** A recently used project, as the Studio home shows it. */
export interface StudioRecentProject {
  dir: string;
  name: string;
  updatedAt: string;
}

/** OVM-managed storage usage, as the Device Center shows it. */
export interface StudioStorageReport {
  home: string;
  models: Array<{ modelId: string; bytes: number }>;
  runtimes: Array<{ name: string; bytes: number }>;
  generated: { bytes: number; files: number };
  partials: { bytes: number; files: number };
  totalBytes: number;
}
/** The probed device graph, as the Device Center consumes it (from ovm-doctor's logic). */
export interface StudioDeviceGraph {
  probedAt: string;
  os: {
    platform: string;
    arch: string;
    release: string;
    nodeVersion: string;
    cpuModel: string;
    logicalCores: number;
    totalMemoryBytes: number;
  };
  gpus: Array<{ vendor: string; name: string; vramBytes?: number; driverVersion?: string; cudaVersion?: string }>;
  ffmpegVersion: string | null;
  encoders: Array<{ name: string; codec: string; hardware: boolean }>;
  runtimes: Array<{ name: string; version: string; command: string }>;
  capabilities: { videoEncode: boolean; hardwareVideoEncode: boolean; aiRunners: boolean };
  warnings: string[];
}

export interface StudioDoctorReport {
  graph: StudioDeviceGraph;
  recommendations: string[];
  report: string;
}

export interface DesktopRuntimeCapabilities {
  desktop: boolean;
  localPersistence: boolean;
  localRender: boolean;
  localGeneration: boolean;
  llmPlanner?: boolean;
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
  runDoctor(): Promise<StudioDoctorReport>;
  projectInfo(): Promise<{ dir: string | null }>;
  storage(): Promise<StudioStorageReport>;
  cleanStorage(): Promise<{ removedBytes: number; removedFiles: number }>;
  recents(): Promise<StudioRecentProject[]>;
  openProjectDir(dir: string): Promise<{ ok: true; project: Project; log: ProjectLog; dir: string } | { ok: false; message: string }>;
  importMedia(): Promise<Array<{ path: string; name: string; media: MediaInfo; kind?: 'video' | 'audio' | 'image'; analysis?: StudioMediaAnalysis }>>;
  renderProject(request: DesktopRenderRequest): Promise<{ state: string; outputPath?: string; error: string | null; jobId?: string }>;
  onRenderProgress(listener: (progress: { jobId?: string; state: string; progress: number }) => void): () => void;
  cancelRender(jobId: string): Promise<{ ok: boolean }>;
  installedModels(): Promise<Array<{ modelId: string; revision: string; installedAt: string }>>;
  installModel(modelId: string): Promise<{ state: string; error?: string }>;
  cancelModelInstall(modelId: string): Promise<{ ok: boolean }>;
  onModelInstallProgress(listener: (progress: { modelId: string; state: string; stage: string; progress: number; bytes: number; totalBytes: number | null }) => void): () => void;
  agentPlan(goal: string, project: Project, log: ProjectLog): Promise<
    | { ok: true; plan: EditPlan; script: EditScript }
    | { ok: false; code: string; message: string }
  >;
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
