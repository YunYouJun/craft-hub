import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMicrosoftTodo } from '../src/local-applications'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

afterEach(() => vi.resetAllMocks())

describe('built-in Microsoft To Do application shortcut', () => {
  it('opens the registered macOS application without opening a browser', async () => {
    const launch = vi.fn().mockResolvedValue(undefined)
    await expect(openMicrosoftTodo({ platform: 'darwin', launch })).resolves.toEqual({ destination: 'application' })
    expect(launch).toHaveBeenCalledExactlyOnceWith('/usr/bin/open', ['-b', 'com.microsoft.to-do-mac'])
  })

  it('waits for the native opener to exit and falls back when it exits unsuccessfully', async () => {
    const native = new EventEmitter()
    const browser = new EventEmitter()
    vi.mocked(spawn).mockReturnValueOnce(native as ChildProcess).mockReturnValueOnce(browser as ChildProcess)
    let resolved = false
    const pending = openMicrosoftTodo({ platform: 'darwin' }).then((result) => {
      resolved = true
      return result
    })
    native.emit('spawn')
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(spawn).toHaveBeenCalledExactlyOnceWith('/usr/bin/open', ['-b', 'com.microsoft.to-do-mac'], { shell: false, stdio: 'ignore', windowsHide: true })
    native.emit('close', 1)
    await Promise.resolve()
    expect(spawn).toHaveBeenNthCalledWith(2, '/usr/bin/open', ['https://to-do.office.com/tasks/'], { shell: false, stdio: 'ignore', windowsHide: true })
    expect(resolved).toBe(false)
    browser.emit('close', 0)
    await expect(pending).resolves.toEqual({ destination: 'website' })
  })

  it('falls back when the native process cannot start', async () => {
    const native = new EventEmitter()
    const browser = new EventEmitter()
    vi.mocked(spawn).mockReturnValueOnce(native as ChildProcess).mockReturnValueOnce(browser as ChildProcess)
    const pending = openMicrosoftTodo({ platform: 'darwin' })
    native.emit('error', new Error('ENOENT'))
    await Promise.resolve()
    browser.emit('close', 0)
    await expect(pending).resolves.toEqual({ destination: 'website' })
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['win32', 'cmd.exe', ['/d', '/s', '/c', 'start', '', 'https://to-do.office.com/tasks/']],
    ['linux', 'xdg-open', ['https://to-do.office.com/tasks/']],
  ] as const)('opens the website on %s without probing an unsupported application protocol', async (platform, command, args) => {
    const launch = vi.fn().mockResolvedValue(undefined)
    await expect(openMicrosoftTodo({ platform, launch })).resolves.toEqual({ destination: 'website' })
    expect(launch).toHaveBeenCalledExactlyOnceWith(command, args)
  })

  it('reports failure when the application and website both fail to open', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('System opener unavailable'))
    await expect(openMicrosoftTodo({ platform: 'darwin', launch })).rejects.toThrow('System opener unavailable')
    expect(launch).toHaveBeenCalledTimes(2)
  })
})
