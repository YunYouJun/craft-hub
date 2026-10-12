/** Copy reviewed text using an available native host or the browser's clipboard permission. */
export async function copyText(text: string): Promise<void> {
  if (window.craftHubDesktop?.copyText)
    await window.craftHubDesktop.copyText(text)
  else
    await navigator.clipboard.writeText(text)
}
