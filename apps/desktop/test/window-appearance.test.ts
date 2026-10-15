import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { mainWindowAppearance, windowBackgroundColor, windowMaterial } from '../src/window-appearance.ts'

describe('main window appearance', () => {
  it('uses the native sidebar material only on macOS', () => {
    expect(windowMaterial('darwin')).toBe('sidebar')
    expect(windowMaterial('win32')).toBeUndefined()
    expect(windowMaterial('linux')).toBeUndefined()
  })

  it('keeps the macOS window transparent and other platforms on the workbench body color', () => {
    expect(windowBackgroundColor('darwin', true)).toBe('#00000000')
    expect(windowBackgroundColor('win32', true)).toBe('#191c22')
    expect(windowBackgroundColor('linux', false)).toBe('#ffffff')
  })

  it('tells the preload which material it draws behind the page', () => {
    expect(mainWindowAppearance('darwin', false)).toEqual({
      additionalArguments: ['--craft-hub-window-material=sidebar'],
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    })
    expect(mainWindowAppearance('win32', false)).toEqual({ additionalArguments: [], backgroundColor: '#ffffff' })
  })
})

async function preloadWindowMaterial(argv?: string[]) {
  let bridge!: { windowMaterial?: string }
  runInNewContext(await readFile(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    process: { argv, platform: 'darwin' },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, value: typeof bridge) => bridge = value },
      ipcRenderer: {},
    }),
  })
  return bridge.windowMaterial
}

describe('preload window material', () => {
  it('exposes only the material the main process passed', async () => {
    expect(await preloadWindowMaterial(['electron', '--craft-hub-window-material=sidebar'])).toBe('sidebar')
    expect(await preloadWindowMaterial(['electron'])).toBeUndefined()
    expect(await preloadWindowMaterial()).toBeUndefined()
  })
})
