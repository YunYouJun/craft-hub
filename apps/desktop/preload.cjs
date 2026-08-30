const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('craftHubDesktop', {
  // Electron's sandbox exposes process as a safe, limited global.
  // eslint-disable-next-line node/prefer-global/process
  platform: process.platform,
  selectProjectDirectory: defaultPath => ipcRenderer.invoke('craft-hub:select-project-directory', defaultPath),
  selectProjectDirectories: defaultPath => ipcRenderer.invoke('craft-hub:select-project-directories', defaultPath),
  openProjectDirectory: projectId => ipcRenderer.invoke('craft-hub:open-project-directory', projectId),
  openProjectInVSCode: projectId => ipcRenderer.invoke('craft-hub:open-project-in-vscode', projectId),
  openProjectInEditor: projectId => ipcRenderer.invoke('craft-hub:open-project-in-editor', projectId),
  openProjectEvidenceInEditor: (projectId, path, line, column) => ipcRenderer.invoke('craft-hub:open-project-evidence-in-editor', projectId, path, line, column),
  openProjectGitRemote: projectId => ipcRenderer.invoke('craft-hub:open-project-git-remote', projectId),
  openCapabilitySourceInEditor: (projectId, capabilityId) => ipcRenderer.invoke('craft-hub:open-capability-source-in-editor', projectId, capabilityId),
  openCapabilityWorkingDirectory: (projectId, capabilityId) => ipcRenderer.invoke('craft-hub:open-capability-working-directory', projectId, capabilityId),
  openProjectInCodex: projectId => ipcRenderer.invoke('craft-hub:open-project-in-codex', projectId),
  openWorkspaceInCodex: workspaceId => ipcRenderer.invoke('craft-hub:open-workspace-in-codex', workspaceId),
  openWorkspaceInEditor: workspaceId => ipcRenderer.invoke('craft-hub:open-workspace-in-editor', workspaceId),
  startProjectInCodex: (projectId, prompt) => ipcRenderer.invoke('craft-hub:start-project-in-codex', projectId, prompt),
  startWorkspaceInCodex: (workspaceId, projectIds, primaryProjectId, prompt) => ipcRenderer.invoke('craft-hub:start-workspace-in-codex', workspaceId, projectIds, primaryProjectId, prompt),
  openCodexThread: threadId => ipcRenderer.invoke('craft-hub:open-codex-thread', threadId),
  focusCodexApplication: () => ipcRenderer.invoke('craft-hub:focus-codex-application'),
  codexActivityStatus: () => ipcRenderer.invoke('craft-hub:codex-activity-status'),
  installCodexActivityHooks: () => ipcRenderer.invoke('craft-hub:install-codex-activity-hooks'),
  uninstallCodexActivityHooks: () => ipcRenderer.invoke('craft-hub:uninstall-codex-activity-hooks'),
  onCodexActivityStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('craft-hub:codex-activity-status-changed', listener)
    return () => ipcRenderer.removeListener('craft-hub:codex-activity-status-changed', listener)
  },
  listTerminalApplications: () => ipcRenderer.invoke('craft-hub:list-terminal-applications'),
  openProjectInTerminal: (projectId, application) => ipcRenderer.invoke('craft-hub:open-project-in-terminal', projectId, application),
  openExternalUrl: url => ipcRenderer.invoke('craft-hub:open-external-url', url),
  openSettingsFile: () => ipcRenderer.invoke('craft-hub:open-settings-file'),
  setTheme: theme => ipcRenderer.invoke('craft-hub:set-theme', theme),
  updateStatus: () => ipcRenderer.invoke('craft-hub:update-status'),
  setAutomaticUpdates: enabled => ipcRenderer.invoke('craft-hub:set-automatic-updates', enabled),
  checkForUpdates: () => ipcRenderer.invoke('craft-hub:check-for-updates'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('craft-hub:update-status-changed', listener)
    return () => ipcRenderer.removeListener('craft-hub:update-status-changed', listener)
  },
  onReplayOnboarding: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('craft-hub:replay-onboarding', listener)
    return () => ipcRenderer.removeListener('craft-hub:replay-onboarding', listener)
  },
  cloudStatus: () => ipcRenderer.invoke('craft-hub:cloud-status'),
  cloudConnect: () => ipcRenderer.invoke('craft-hub:cloud-connect'),
  cloudDisconnect: () => ipcRenderer.invoke('craft-hub:cloud-disconnect'),
  cloudSynchronize: () => ipcRenderer.invoke('craft-hub:cloud-synchronize'),
  consumeMarketplaceSourceImport: () => ipcRenderer.invoke('craft-hub:consume-marketplace-source-import'),
  onMarketplaceSourceImport: (callback) => {
    const listener = (_event, catalogUrl) => callback(catalogUrl)
    ipcRenderer.on('craft-hub:marketplace-source-import', listener)
    return () => ipcRenderer.removeListener('craft-hub:marketplace-source-import', listener)
  },
})
