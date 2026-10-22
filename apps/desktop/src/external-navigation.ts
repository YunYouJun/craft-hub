import type { WebContents } from 'electron'
import { externalHttpUrl } from './open-targets.ts'

/** Keep website links in the system browser while preserving workbench and contact-app navigation. */
export function installExternalNavigationHandlers(
  contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  workbenchUrl: string,
  openExternal: (url: string) => Promise<void>,
  onError: (error: unknown) => void,
): void {
  const workbenchOrigin = new URL(workbenchUrl).origin

  function httpUrl(value: string): string | undefined {
    try {
      return externalHttpUrl(value)
    }
    catch {
      return undefined
    }
  }

  function openWebsite(url: string): void {
    void openExternal(url).catch(onError)
  }

  contents.setWindowOpenHandler(({ url }) => {
    const website = httpUrl(url)
    if (website)
      openWebsite(website)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const website = httpUrl(url)
    if (!website || new URL(website).origin === workbenchOrigin)
      return
    event.preventDefault()
    openWebsite(website)
  })
}
