'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * The narrow, typed bridge (CJS: sandboxed renderers do not support
 * ESM preloads). The renderer gets exactly these local powers and
 * nothing else - no Node, no filesystem, no network extras.
 */
const bridge = {
  staticCapabilities: { desktop: true, localPersistence: true, localRender: true, localGeneration: false },
  importMedia: () => ipcRenderer.invoke('ovm:import-media'),
  renderProject: (payload) => ipcRenderer.invoke('ovm:render', payload),
  onRenderProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('ovm:render-progress', handler);
    return () => ipcRenderer.removeListener('ovm:render-progress', handler);
  },
  capabilities: () => ipcRenderer.invoke('ovm:capabilities'),
  openProject: () => ipcRenderer.invoke('ovm:open-project'),
  saveProject: (project, log) => ipcRenderer.invoke('ovm:save-project', { project, log }),
  runDoctor: () => ipcRenderer.invoke('ovm:doctor'),
};

contextBridge.exposeInMainWorld('ovm', bridge);
