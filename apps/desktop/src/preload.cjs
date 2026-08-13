'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * The narrow, typed bridge (CJS: sandboxed renderers do not support
 * ESM preloads). The renderer gets exactly these local powers and
 * nothing else - no Node, no filesystem, no network extras.
 */
const bridge = {
  staticCapabilities: { desktop: true, localPersistence: true, localRender: false, localGeneration: false },
  capabilities: () => ipcRenderer.invoke('ovm:capabilities'),
  openProject: () => ipcRenderer.invoke('ovm:open-project'),
  saveProject: (project, log) => ipcRenderer.invoke('ovm:save-project', { project, log }),
  runDoctor: () => ipcRenderer.invoke('ovm:doctor'),
};

contextBridge.exposeInMainWorld('ovm', bridge);
