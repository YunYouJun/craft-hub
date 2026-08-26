import type { AboutPanelOptionsOptions } from 'electron'

export const projectUrl = 'https://github.com/YunYouJun/craft-hub'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

/** Build the self-contained document shown by the custom About window. */
export function aboutDocument(version: string, iconDataUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <title>About Craft Hub</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; color: CanvasText; background: Canvas; text-align: center; user-select: none; }
      main { min-height: 100vh; display: grid; place-content: center; justify-items: center; padding: 28px; }
      .app-icon { width: 96px; height: 96px; margin-bottom: 12px; }
      h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.02em; }
      .version { margin: 5px 0 18px; color: GrayText; font-size: 13px; }
      .description { margin: 0 0 14px; font-size: 14px; }
      .github-link { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 8px; color: LinkText; font-size: 14px; font-weight: 550; text-decoration: none; }
      .github-link:hover { background: color-mix(in srgb, CanvasText 8%, transparent); text-decoration: underline; }
      .github-link:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
      .github-icon { width: 18px; height: 18px; fill: currentColor; }
      .license, .copyright { margin: 14px 0 0; color: GrayText; font-size: 12px; }
      .copyright { margin-top: 5px; }
    </style>
  </head>
  <body>
    <main>
      <img class="app-icon" src="${escapeHtml(iconDataUrl)}" alt="Craft Hub icon">
      <h1>Craft Hub</h1>
      <p class="version">Version ${escapeHtml(version)}</p>
      <p class="description">A local, cross-project developer workbench.</p>
      <a class="github-link" href="${projectUrl}" target="_blank" rel="noreferrer">
        <svg class="github-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11.2 11.2 0 0 1 5.8 0C16.8 5 18 5.3 18 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.5 5.7.4.4.8 1.1.8 2.2v3.2c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"/></svg>
        <span>GitHub</span>
      </a>
      <p class="license">Open source under the MIT License.</p>
      <p class="copyright">Copyright © YunYouJun</p>
    </main>
  </body>
</html>`
}

/** Build the metadata shown by the native About Craft Hub menu item. */
export function aboutPanelOptions(version: string, iconPath: string): AboutPanelOptionsOptions {
  return {
    applicationName: 'Craft Hub',
    applicationVersion: version,
    version,
    copyright: 'Copyright © YunYouJun',
    credits: [
      'A local, cross-project developer workbench.',
      '',
      'Open source under the MIT License.',
    ].join('\n'),
    authors: ['YunYouJun'],
    website: projectUrl,
    iconPath,
  }
}
