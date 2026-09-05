import type { DevelopmentProcessExit as WebDevelopmentProcessExit } from './dev-vite.ts'

export interface DevelopmentProcessExit extends WebDevelopmentProcessExit {
  name: string
}

export interface DevelopmentEnvironmentExitSources {
  buildWatcherExit: Promise<DevelopmentProcessExit>
  runtimeCleanExit: Promise<DevelopmentProcessExit>
  runtimeFailure: Promise<never>
  webServerClosed: Promise<WebDevelopmentProcessExit>
}

/** Wait until one of the processes required by the development environment exits. */
export function waitForDevelopmentEnvironmentExit(
  sources: DevelopmentEnvironmentExitSources,
): Promise<DevelopmentProcessExit> {
  return Promise.race([
    sources.webServerClosed.then(exit => ({ ...exit, name: 'Vite dev server' })),
    sources.buildWatcherExit,
    sources.runtimeCleanExit,
    sources.runtimeFailure,
  ])
}
