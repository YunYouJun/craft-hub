/** Require the platform's conventional modifier before activating terminal links. */
export function shouldActivateTerminalLink(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
  platform: string,
): boolean {
  return /Mac|darwin/i.test(platform) ? event.metaKey : event.ctrlKey
}

/** Accept only browser-safe HTTP links from untrusted terminal output. */
export function terminalHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  }
  catch {
    return undefined
  }
}
