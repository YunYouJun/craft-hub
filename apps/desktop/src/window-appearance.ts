import type { BrowserWindowConstructorOptions } from 'electron'

/** Native window material the renderer may let show through its sidebar. */
export type DesktopWindowMaterial = 'sidebar'

/** Command-line switch that tells the preload which native material the main window uses. */
export const windowMaterialSwitch = '--craft-hub-window-material'

const transparentBackground = '#00000000'
// Match the workbench body surface so the first frame before CSS paints does not flash.
const lightBackground = '#ffffff'
const darkBackground = '#191c22'

/** Select the native material for the main window; only macOS has a sidebar material. */
export function windowMaterial(platform: NodeJS.Platform): DesktopWindowMaterial | undefined {
  return platform === 'darwin' ? 'sidebar' : undefined
}

/** Window background behind the web contents; transparent when a native material must show through. */
export function windowBackgroundColor(platform: NodeJS.Platform, dark: boolean): string {
  if (windowMaterial(platform))
    return transparentBackground
  return dark ? darkBackground : lightBackground
}

/** BrowserWindow options that give the main window its native material and launch background. */
export function mainWindowAppearance(platform: NodeJS.Platform, dark: boolean): Pick<BrowserWindowConstructorOptions, 'backgroundColor' | 'vibrancy' | 'visualEffectState'> & { additionalArguments: string[] } {
  const material = windowMaterial(platform)
  return {
    backgroundColor: windowBackgroundColor(platform, dark),
    ...(material ? { vibrancy: material, visualEffectState: 'followWindow' as const } : {}),
    additionalArguments: material ? [`${windowMaterialSwitch}=${material}`] : [],
  }
}
