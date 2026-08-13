import type { MediaInfo, Project, ProjectLog } from '@openvideomaker/schema';

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

/**
 * The desktop bridge is exposed by the Electron preload as a NARROW
 * typed object. In the browser it simply does not exist - capability
 * detection changes available options without changing semantics.
 */
export interface StudioDesktopBridge {
  staticCapabilities: {
    desktop: boolean;
    localPersistence: boolean;
    localRender: boolean;
    localGeneration: boolean;
  };
  openProject(): Promise<{ project: Project; log: ProjectLog } | null>;
  saveProject(project: Project, log: ProjectLog): Promise<{ ok: boolean; appended?: number; dir?: string; reason?: string }>;
  runDoctor(): Promise<unknown>;
  importMedia(): Promise<Array<{ path: string; name: string; media: MediaInfo }>>;
  renderProject(request: DesktopRenderRequest): Promise<{ state: string; outputPath?: string; error: string | null }>;
  onRenderProgress(listener: (progress: { state: string; progress: number }) => void): () => void;
}

declare global {
  interface Window {
    ovm?: StudioDesktopBridge;
  }
}

export function getDesktopBridge(): StudioDesktopBridge | null {
  return typeof window !== 'undefined' && window.ovm ? window.ovm : null;
}
