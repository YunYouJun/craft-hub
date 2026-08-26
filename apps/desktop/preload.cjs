const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('craftHubDesktop', {
  // Electron's sandbox exposes process as a safe, limited global.
  // eslint-disable-next-line node/prefer-global/process
  platform: process.platform,
  selectProjectDirectory: () => ipcRenderer.invoke('craft-hub:select-project-directory'),
  selectProjectDirectories: () => ipcRenderer.invoke('craft-hub:select-project-directories'),
  openProjectInVSCode: projectId => ipcRenderer.invoke('craft-hub:open-project-in-vscode', projectId),
  openCapabilitySourceInVSCode: (projectId, capabilityId) => ipcRenderer.invoke('craft-hub:open-capability-source-in-vscode', projectId, capabilityId),
  openProjectInCodex: projectId => ipcRenderer.invoke('craft-hub:open-project-in-codex', projectId),
  startProjectInCodex: (projectId, prompt) => ipcRenderer.invoke('craft-hub:start-project-in-codex', projectId, prompt),
  openCodexThread: threadId => ipcRenderer.invoke('craft-hub:open-codex-thread', threadId),
  listTerminalApplications: () => ipcRenderer.invoke('craft-hub:list-terminal-applications'),
  openProjectInTerminal: (projectId, application) => ipcRenderer.invoke('craft-hub:open-project-in-terminal', projectId, application),
  openExternalUrl: url => ipcRenderer.invoke('craft-hub:open-external-url', url),
  openSettingsFile: () => ipcRenderer.invoke('craft-hub:open-settings-file'),
  setTheme: theme => ipcRenderer.invoke('craft-hub:set-theme', theme),
  cloudStatus: () => ipcRenderer.invoke('craft-hub:cloud-status'),
  cloudConnect: () => ipcRenderer.invoke('craft-hub:cloud-connect'),
  cloudDisconnect: () => ipcRenderer.invoke('craft-hub:cloud-disconnect'),
  cloudSynchronize: () => ipcRenderer.invoke('craft-hub:cloud-synchronize'),
})
