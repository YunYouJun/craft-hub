import type { AboutPanelOptionsOptions } from 'electron'
import type { DesktopAboutBranding } from './distribution.ts'
import { communityDesktopAboutBranding } from './distribution.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

/** Build the self-contained document shown by the custom About window. */
export function aboutDocument(version: string, iconDataUrl: string, applicationName = 'Craft Hub', branding: DesktopAboutBranding = communityDesktopAboutBranding): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <title>About ${escapeHtml(applicationName)}</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; color: CanvasText; background: Canvas; text-align: center; user-select: none; }
      main { min-height: 100vh; display: grid; place-content: center; justify-items: center; padding: 28px; }
      .app-icon { width: 96px; height: 96px; margin-bottom: 12px; }
      h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.02em; }
      .version { margin: 5px 0 18px; color: GrayText; font-size: 13px; }
      .description { margin: 0 0 14px; font-size: 14px; }
      .project-link { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 8px; color: LinkText; font-size: 14px; font-weight: 550; text-decoration: none; }
      .project-link:hover { background: color-mix(in srgb, CanvasText 8%, transparent); text-decoration: underline; }
      .project-link:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
      .license, .copyright { margin: 14px 0 0; color: GrayText; font-size: 12px; }
      .copyright { margin-top: 5px; }
    </style>
  </head>
  <body>
    <main>
      <img class="app-icon" src="${escapeHtml(iconDataUrl)}" alt="Application icon">
      <h1>${escapeHtml(applicationName)}</h1>
      <p class="version">Version ${escapeHtml(version)}</p>
      <p class="description">${escapeHtml(branding.description)}</p>
      <a class="project-link" href="${escapeHtml(branding.website)}" target="_blank" rel="noreferrer">
        <span>${escapeHtml(branding.linkLabel)}</span>
      </a>
      <p class="license">${escapeHtml(branding.license)}</p>
      <p class="copyright">${escapeHtml(branding.copyright)}</p>
    </main>
  </body>
</html>`
}

/** Build the metadata shown by the native About Craft Hub menu item. */
export function aboutPanelOptions(version: string, iconPath: string, applicationName = 'Craft Hub', branding: DesktopAboutBranding = communityDesktopAboutBranding): AboutPanelOptionsOptions {
  return {
    applicationName,
    applicationVersion: version,
    version,
    copyright: branding.copyright,
    credits: [
      branding.description,
      '',
      branding.license,
    ].join('\n'),
    authors: branding.authors,
    website: branding.website,
    iconPath,
  }
}
