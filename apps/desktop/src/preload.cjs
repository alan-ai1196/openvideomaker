'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * The narrow, typed bridge (CJS: sandboxed renderers do not support
 * ESM preloads). The renderer gets exactly these local powers and
 * nothing else - no Node, no filesystem, no network extras. Generation
 * requests are validated in the main process and may only reference
 * media paths the app already knows.
 */
const bridge = {
  staticCapabilities: { desktop: true, localPersistence: true, localRender: true, localGeneration: true },
  importMedia: () => ipcRenderer.invoke('ovm:import-media'),
  renderProject: (payload) => ipcRenderer.invoke('ovm:render', payload),
  onRenderProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('ovm:render-progress', handler);
    return () => ipcRenderer.removeListener('ovm:render-progress', handler);
  },
  generate: (request) => ipcRenderer.invoke('ovm:generate', request),
  cancelGenerate: (jobId) => ipcRenderer.invoke('ovm:generate-cancel', { jobId }),
  onGenerateProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('ovm:generate-progress', handler);
    return () => ipcRenderer.removeListener('ovm:generate-progress', handler);
  },
  generationCapabilities: () => ipcRenderer.invoke('ovm:generation-capabilities'),
  capabilities: () => ipcRenderer.invoke('ovm:capabilities'),
  openProject: () => ipcRenderer.invoke('ovm:open-project'),
  saveProject: (project, log) => ipcRenderer.invoke('ovm:save-project', { project, log }),
  runDoctor: () => ipcRenderer.invoke('ovm:doctor'),
};

contextBridge.exposeInMainWorld('ovm', bridge);
