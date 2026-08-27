/// <reference types="vite/client" />

interface Window {
  craftHubDesktop?: {
    platform?: string
    selectProjectDirectory?: () => Promise<string | undefined>
    selectProjectDirectories?: () => Promise<string[] | undefined>
    openProjectInVSCode?: (projectId: string) => Promise<void>
    openCapabilitySourceInVSCode?: (projectId: string, capabilityId: string) => Promise<void>
    openProjectInCodex?: (projectId: string) => Promise<void>
    openWorkspace?: (workspaceId: string, launcher: 'vscode' | 'codebuddy' | 'codex') => Promise<void>
    startProjectInCodex?: (projectId: string, prompt: string) => Promise<void>
    openCodexThread?: (threadId: string) => Promise<void>
    listTerminalApplications?: () => Promise<string[]>
    openProjectInTerminal?: (projectId: string, application?: string) => Promise<void>
    openExternalUrl?: (url: string) => Promise<void>
    openSettingsFile?: () => Promise<void>
    setTheme?: (theme: 'system' | 'light' | 'dark') => Promise<void>
    cloudStatus?: () => Promise<{
      state: 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error'
      deviceId?: string
      lastSyncAt?: string
      diagnostic?: string
    }>
    cloudConnect?: () => Promise<void>
    cloudDisconnect?: () => Promise<void>
    cloudSynchronize?: () => Promise<void>
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare module '*.css'
