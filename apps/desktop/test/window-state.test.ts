import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWindowState, restoreWindowState, writeWindowState } from '../src/window-state.ts'

const defaults = { width: 1440, height: 900, minWidth: 900, minHeight: 620 }
const laptop = { x: 0, y: 25, width: 1512, height: 920 }
const external = { x: 1512, y: 0, width: 2560, height: 1415 }
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('main window state', () => {
  it('opens centered at the default size without a usable saved frame', () => {
    for (const saved of [undefined, null, 'frame', { width: '1200', height: 800 }, { width: Number.NaN, height: 800 }])
      expect(restoreWindowState(saved, [laptop], defaults)).toEqual({ width: 1440, height: 900, maximized: false })
  })

  it('restores the saved frame and maximized state on a connected display', () => {
    expect(restoreWindowState({ x: 1800, y: 120, width: 1600, height: 1000, maximized: true }, [laptop, external], defaults))
      .toEqual({ x: 1800, y: 120, width: 1600, height: 1000, maximized: true })
  })

  it('centers a frame whose title bar is no longer on any display', () => {
    expect(restoreWindowState({ x: 1800, y: 120, width: 1200, height: 800, maximized: false }, [laptop], defaults))
      .toEqual({ width: 1200, height: 800, maximized: false })
    expect(restoreWindowState({ x: 1450, y: 100, width: 1200, height: 800 }, [laptop], defaults))
      .toEqual({ width: 1200, height: 800, maximized: false })
  })

  it('keeps the size within the minimum and the largest work area', () => {
    expect(restoreWindowState({ x: 0, y: 25, width: 400, height: 300 }, [laptop], defaults))
      .toEqual({ x: 0, y: 25, width: 900, height: 620, maximized: false })
    expect(restoreWindowState({ x: 0, y: 25, width: 4000, height: 3000 }, [laptop], defaults))
      .toEqual({ x: 0, y: 25, width: 1512, height: 920, maximized: false })
  })

  it('round-trips the saved frame and ignores unreadable files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-window-state-'))
    directories.push(directory)
    const file = join(directory, 'window-state.json')
    expect(readWindowState(file)).toBeUndefined()
    writeWindowState(file, { x: 10, y: 40, width: 1200, height: 800 }, true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: 10, y: 40, width: 1200, height: 800, maximized: true })
    expect(readWindowState(file)).toEqual({ x: 10, y: 40, width: 1200, height: 800, maximized: true })
    expect(() => writeWindowState(join(directory, 'missing', 'state.json'), { x: 0, y: 0, width: 900, height: 620 }, false)).not.toThrow()
  })
})
