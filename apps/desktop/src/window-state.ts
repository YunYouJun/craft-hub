import { readFileSync, writeFileSync } from 'node:fs'

/** Screen rectangle in Electron's device-independent pixels. */
export interface WindowArea {
  x: number
  y: number
  width: number
  height: number
}

/** Main window frame restored on the next launch. Position is omitted when the window should be centered. */
export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** Default and minimum sizes used when no usable saved frame exists. */
export interface WindowStateDefaults {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

// A restored window must expose this much of its top edge on some display, so the title bar stays reachable.
const minimumVisibleWidth = 120
const minimumVisibleHeight = 40

/**
 * Turns a saved frame into launch bounds that fit the current displays. A frame from a disconnected display falls back
 * to a centered window, and a frame larger than every display shrinks to the largest work area.
 */
export function restoreWindowState(saved: unknown, displays: WindowArea[], defaults: WindowStateDefaults): WindowState {
  const fallback: WindowState = { width: defaults.width, height: defaults.height, maximized: false }
  if (!isRecord(saved) || !isFiniteNumber(saved.width) || !isFiniteNumber(saved.height))
    return fallback
  const largest = displays.reduce<WindowArea | undefined>((best, area) => !best || area.width * area.height > best.width * best.height ? area : best, undefined)
  const width = Math.round(clamp(saved.width, defaults.minWidth, largest?.width ?? saved.width))
  const height = Math.round(clamp(saved.height, defaults.minHeight, largest?.height ?? saved.height))
  const state: WindowState = { width, height, maximized: saved.maximized === true }
  if (isFiniteNumber(saved.x) && isFiniteNumber(saved.y)) {
    const titleBar = { x: Math.round(saved.x), y: Math.round(saved.y), width, height: minimumVisibleHeight }
    if (displays.some(area => overlap(titleBar, area, minimumVisibleWidth, minimumVisibleHeight))) {
      state.x = titleBar.x
      state.y = titleBar.y
    }
  }
  return state
}

/** Reads the saved frame; a missing or unreadable file means the window opens at its defaults. */
export function readWindowState(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  }
  catch {
    return undefined
  }
}

/**
 * Saves the window's normal (unmaximized) frame. It runs while the window closes, so it writes synchronously and never
 * lets a disk error block quitting.
 */
export function writeWindowState(file: string, bounds: WindowArea, maximized: boolean): void {
  const state: WindowState = { ...bounds, maximized }
  try {
    writeFileSync(file, `${JSON.stringify(state)}\n`)
  }
  catch {}
}

function overlap(window: WindowArea, area: WindowArea, minimumWidth: number, minimumHeight: number): boolean {
  const width = Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x)
  const height = Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y)
  return width >= minimumWidth && height >= minimumHeight
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
