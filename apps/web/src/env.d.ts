/// <reference types="vite/client" />

type DesktopNavigation
  = | { kind: 'home' }
    | { kind: 'marketplace' }
    | { kind: 'settings' }
    | { kind: 'workspace', workspaceId: string, ownerScopeId?: string }
    | { kind: 'project', reference: import('craft-hub').ProjectReference, matches: import('craft-hub').ProjectRecord[], capabilityId?: string }

interface Window {
  craftHubDesktop?: {
    platform?: string
    selectProjectDirectory?: (defaultPath?: string) => Promise<string | undefined>
    selectProjectDirectories?: (defaultPath?: string) => Promise<string[] | undefined>
    openProjectDirectory?: (projectId: string) => Promise<void>
    openProjectInVSCode?: (projectId: string) => Promise<void>
    openProjectInEditor?: (projectId: string) => Promise<void>
    openProjectEvidenceInEditor?: (projectId: string, path: string, line?: number, column?: number) => Promise<void>
    openProjectGitRemote?: (projectId: string) => Promise<void>
    openCapabilitySourceInEditor?: (projectId: string, capabilityId: string) => Promise<void>
    openCapabilityWorkingDirectory?: (projectId: string, capabilityId: string) => Promise<void>
    openProjectInCodex?: (projectId: string) => Promise<void>
    openWorkspaceInCodex?: (workspaceId: string) => Promise<void>
    openWorkspaceInEditor?: (workspaceId: string) => Promise<void>
    startProjectInCodex?: (projectId: string, prompt: string, packageRelativePath?: string) => Promise<void>
    startWorkspaceInCodex?: (workspaceId: string, projectIds: string[], primaryProjectId: string, prompt: string) => Promise<{ taskId: string, threadId: string }>
    openCodexThread?: (threadId: string) => Promise<void>
    focusCodexApplication?: () => Promise<void>
    codexActivityStatus?: () => Promise<CodexActivityStatus | undefined>
    installCodexActivityHooks?: () => Promise<CodexActivityStatus | undefined>
    uninstallCodexActivityHooks?: () => Promise<CodexActivityStatus | undefined>
    onCodexActivityStatus?: (callback: (status: CodexActivityStatus) => void) => () => void
    consumeCelebration?: () => Promise<boolean>
    onCelebrationRequested?: (callback: () => void) => () => void
    listTerminalApplications?: () => Promise<string[]>
    openProjectInTerminal?: (projectId: string, application?: string) => Promise<void>
    openDotfilesInTerminal?: () => Promise<void>
    openExternalUrl?: (url: string) => Promise<void>
    openSettingsFile?: () => Promise<void>
    setTheme?: (theme: 'system' | 'light' | 'dark') => Promise<void>
    updateStatus?: () => Promise<DesktopUpdateStatus | undefined>
    setAutomaticUpdates?: (enabled: boolean) => Promise<DesktopUpdateStatus>
    checkForUpdates?: () => Promise<DesktopUpdateStatus>
    onUpdateStatus?: (callback: (status: DesktopUpdateStatus) => void) => () => void
    onReplayOnboarding?: (callback: () => void) => () => void
    onOpenHelp?: (callback: () => void) => () => void
    cloudStatus?: () => Promise<{
      state: 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error'
      deviceId?: string
      lastSyncAt?: string
      diagnostic?: string
    }>
    cloudConnect?: () => Promise<void>
    cloudDisconnect?: () => Promise<void>
    cloudSynchronize?: () => Promise<void>
    consumeDesktopNavigation?: () => Promise<DesktopNavigation | undefined>
    onDesktopNavigation?: (callback: (navigation: DesktopNavigation) => void) => () => void
    verifyProjectReference?: (reference: import('craft-hub').ProjectReference, path: string) => Promise<boolean>
    consumeMarketplaceSourceImport?: () => Promise<string | undefined>
    onMarketplaceSourceImport?: (callback: (catalogUrl: string) => void) => () => void
  }
}

interface CodexActivityStatus {
  diagnostic?: string
  hooksPath?: string
  installed: boolean
  requiresTrustReview?: boolean
  runningSessionIds: string[]
  supported: boolean
}

interface DesktopUpdateStatus {
  automaticCheck: boolean
  currentVersion: string
  message?: string
  phase: 'available' | 'checking' | 'disabled' | 'downloaded' | 'error' | 'idle' | 'unsupported' | 'up-to-date'
  releaseName?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare module '*.css'
