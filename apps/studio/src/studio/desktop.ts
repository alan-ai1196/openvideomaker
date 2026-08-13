import type { Project, ProjectLog } from '@openvideomaker/schema';

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
}

declare global {
  interface Window {
    ovm?: StudioDesktopBridge;
  }
}

export function getDesktopBridge(): StudioDesktopBridge | null {
  return typeof window !== 'undefined' && window.ovm ? window.ovm : null;
}
