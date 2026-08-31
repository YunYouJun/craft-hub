export type DevelopmentMode = 'desktop' | 'web'

export interface InitialDevelopmentServices<WebServer> {
  startRuntime: (webServer?: WebServer) => Promise<void>
  startWeb: () => Promise<WebServer>
}

/** Start initial development services in dependency order for the selected host. */
export async function startInitialDevelopmentServices<WebServer>(
  mode: DevelopmentMode,
  services: InitialDevelopmentServices<WebServer>,
): Promise<WebServer> {
  if (mode === 'web') {
    await services.startRuntime()
    return services.startWeb()
  }

  const webServer = await services.startWeb()
  await services.startRuntime(webServer)
  return webServer
}
