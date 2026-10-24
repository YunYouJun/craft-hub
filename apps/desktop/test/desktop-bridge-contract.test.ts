import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

async function loadBridges() {
  const invoke = vi.fn(async () => undefined)
  const postMessage = vi.fn(async () => undefined)
  const fetch = vi.fn(async (): Promise<{ ok: boolean, json: () => Promise<{ value?: unknown, error?: string }> }> => ({
    ok: true,
    json: async () => ({ value: 'sidecar-result' }),
  }))
  let electron!: DesktopBridgeV1
  runInNewContext(await readFile(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    process: { platform: 'darwin' },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, value: DesktopBridgeV1) => electron = value },
      ipcRenderer: { invoke },
    }),
  })
  const swift = await readFile(new URL('../../macos/Sources/CraftHubMac/DesktopBridge.swift', import.meta.url), 'utf8')
  const script = swift.match(/static let script\s*=\s*"""\r?\n([\s\S]*?)\r?\n[\t ]*"""/)?.[1]
  if (!script)
    throw new Error('The native bridge injection script was not found')
  const pageEvents = new Map<string, () => void>()
  const streams: Array<{ url: string, close: ReturnType<typeof vi.fn>, onmessage?: (event: { data: string }) => void }> = []
  class EventSource {
    readonly url: string
    readonly close = vi.fn()
    onmessage?: (event: { data: string }) => void
    constructor(url: string) {
      this.url = url
      streams.push(this)
    }
  }
  const window = { webkit: { messageHandlers: { craftHubBridge: { postMessage } } }, addEventListener: (name: string, callback: () => void) => pageEvents.set(name, callback) } as unknown as Window
  runInNewContext(script.replaceAll('\\(handlerName)', 'craftHubBridge'), { window, fetch, URL, EventSource })
  const deliverLink = (window as unknown as { __craftHubDesktopLink: (url: string) => Promise<void> }).__craftHubDesktopLink
  return { electron, native: window.craftHubDesktop!, invoke, postMessage, fetch, deliverLink, streams, pageEvents }
}

describe('versioned desktop bridge contract', () => {
  it('shares the activity stream, releases subscriptions and ignores retired streams and late status reads', async () => {
    const { native, streams, pageEvents, fetch, postMessage } = await loadBridges()
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = native.onCodexActivityStatus!(first)
    const stopSecond = native.onCodexActivityStatus!(second)
    expect(streams.map(stream => stream.url)).toEqual(['/__craft_hub_host/codex-activity-events'])
    let release!: (value: Awaited<ReturnType<typeof fetch>>) => void
    fetch.mockImplementationOnce(() => new Promise(resolve => release = resolve))
    const read = native.codexActivityStatus!()
    const active = { supported: true, installed: true, runningSessionIds: ['fixture'] }
    streams[0]!.onmessage!({ data: JSON.stringify(active) })
    release({ ok: true, json: async () => ({ value: { ...active, installed: false } }) })
    expect(await read).toEqual(active)
    expect(first).toHaveBeenCalledExactlyOnceWith(active)
    expect(second).toHaveBeenCalledExactlyOnceWith(active)
    stopFirst()
    expect(streams[0]!.close).not.toHaveBeenCalled()
    stopSecond()
    expect(streams[0]!.close).toHaveBeenCalledOnce()
    native.onCodexActivityStatus!(first)
    streams[0]!.onmessage!({ data: JSON.stringify(active) })
    expect(first).toHaveBeenCalledOnce()
    pageEvents.get('pagehide')!()
    expect(streams[1]!.close).toHaveBeenCalledOnce()
    streams[1]!.onmessage!({ data: JSON.stringify(active) })
    expect(first).toHaveBeenCalledOnce()
    await native.installCodexActivityHooks!()
    await native.uninstallCodexActivityHooks!()
    expect(postMessage.mock.calls).toEqual(['install-codex-activity-hooks', 'uninstall-codex-activity-hooks'].map(action => [{ action, input: {} }]))
  })
  it('routes cloud controls through Swift without exposing callback, vault or approval methods', async () => {
    const { native, postMessage, fetch } = await loadBridges()
    await native.cloudStatus!()
    await native.cloudConnect!()
    await native.cloudDisconnect!()
    await native.cloudSynchronize!()
    expect(postMessage.mock.calls).toEqual(['cloud-status', 'cloud-connect', 'cloud-disconnect', 'cloud-synchronize'].map(action => [{ action, input: {} }]))
    expect(fetch).not.toHaveBeenCalled()
    expect(Object.keys(native).filter(key => /vault|approval|callback/i.test(key))).toEqual([])
  })
  it('consumes startup links once, notifies live listeners, and keeps import and celebration independent', async () => {
    const { native, fetch, deliverLink, postMessage } = await loadBridges()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'navigation', navigation: { kind: 'home' } } }) })
    await deliverLink('craft-hub-native://open?v=1')
    expect(await native.consumeDesktopNavigation!()).toEqual({ kind: 'home' })
    expect(await native.consumeDesktopNavigation!()).toBeUndefined()
    const listener = vi.fn()
    const stop = native.onDesktopNavigation!(listener)
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'navigation', navigation: { kind: 'settings' } } }) })
    await deliverLink('craft-hub-native://open?v=1&view=settings')
    expect(listener).toHaveBeenCalledExactlyOnceWith({ kind: 'settings' })
    expect(await native.consumeDesktopNavigation!()).toBeUndefined()
    stop()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'celebration' } }) })
    await deliverLink('craft-hub-native://celebrate?v=1')
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'marketplace-import', catalogUrl: 'https://example.com/catalog.json' } }) })
    await deliverLink('craft-hub-native://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com%2Fcatalog.json')
    expect(await native.consumeCelebration!()).toBe(true)
    expect(await native.consumeCelebration!()).toBe(false)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ action: 'open-plugin-management', input: { catalogUrl: 'https://example.com/catalog.json' } })
    expect(await native.consumeMarketplaceSourceImport!()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('opens native plugin management without replaying an older web destination or importing a source twice', async () => {
    const { native, fetch, deliverLink, postMessage } = await loadBridges()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'navigation', navigation: { kind: 'home' } } }) })
    await deliverLink('craft-hub-native://open?v=1')
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'navigation', navigation: { kind: 'marketplace' } } }) })
    await deliverLink('craft-hub-native://open?v=1&view=marketplace')
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ action: 'open-plugin-management', input: {} })
    expect(await native.consumeDesktopNavigation!()).toBeUndefined()

    const listener = vi.fn()
    native.onMarketplaceSourceImport!(listener)
    let release!: (value: Awaited<ReturnType<typeof fetch>>) => void
    fetch.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const old = deliverLink('craft-hub-native://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com%2Fold.json')
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'marketplace-import', catalogUrl: 'https://example.com/new.json' } }) })
    await deliverLink('craft-hub-native://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com%2Fnew.json')
    release({ ok: true, json: async () => ({ value: { kind: 'marketplace-import', catalogUrl: 'https://example.com/old.json' } }) })
    await old
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(postMessage).toHaveBeenLastCalledWith({ action: 'open-plugin-management', input: { catalogUrl: 'https://example.com/new.json' } })
    expect(listener).not.toHaveBeenCalled()
    expect(await native.consumeMarketplaceSourceImport!()).toBeUndefined()
    expect(fetch.mock.calls.every((call: unknown[]) => call[0] === '/__craft_hub_host/resolve-desktop-link')).toBe(true)
  })

  it('drops a late project resolution after a newer navigation and never dispatches rejected links', async () => {
    const { native, fetch, deliverLink } = await loadBridges()
    const listener = vi.fn()
    native.onDesktopNavigation!(listener)
    let release!: (value: Awaited<ReturnType<typeof fetch>>) => void
    fetch.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const old = deliverLink('craft-hub-native://project?v=1&repo=https%3A%2F%2Fexample.com%2Frepo')
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { kind: 'navigation', navigation: { kind: 'home' } } }) })
    await deliverLink('craft-hub-native://open?v=1')
    release({ ok: true, json: async () => ({ value: { kind: 'navigation', navigation: { kind: 'project', matches: [] } } }) })
    await old
    expect(listener).toHaveBeenCalledExactlyOnceWith({ kind: 'home' })
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'unexpected-action' }) })
    await expect(deliverLink('craft-hub-native://run?v=1')).rejects.toThrow('unexpected-action')
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('keeps the documented capability inventory aligned with both hosts and the renderer declaration', async () => {
    const { electron, native } = await loadBridges()
    expect(electron.bridgeVersion).toBe(1)
    expect(native.bridgeVersion).toBe(1)
    expect(electron.hostKind).toBe('electron')
    expect(native.hostKind).toBe('macos')
    const source = ts.createSourceFile('env.d.ts', await readFile(new URL('../../web/src/env.d.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest)
    const declaration = source.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name.text === 'DesktopBridgeV1')
    if (!declaration || !ts.isInterfaceDeclaration(declaration))
      throw new Error('The renderer bridge contract was not found')
    const declared = declaration.members.map(member => member.name?.getText(source)).sort()
    const doc = await readFile(new URL('../../../docs/guide/desktop-bridge.md', import.meta.url), 'utf8')
    const inventory = doc.split('<!-- bridge-inventory:start -->')[1].split('<!-- bridge-inventory:end -->')[0]
    const rows = Array.from(inventory.matchAll(/\| `(?<name>\w+)` \| (?<electron>是|缺) \| (?<native>是|缺) \|/g), match => match.groups!)
    expect(rows.map(row => row.name).sort()).toEqual(declared)
    expect(Object.keys(electron).sort()).toEqual(rows.filter(row => row.electron === '是').map(row => row.name).sort())
    expect(Object.keys(native).sort()).toEqual(rows.filter(row => row.native === '是').map(row => row.name).sort())
  })

  it('routes OS actions through the native handler and runtime state through the authenticated sidecar', async () => {
    const { native, postMessage, fetch } = await loadBridges()
    await native.copyText!('a local note')
    await native.selectProjectDirectories!('/projects')
    expect(postMessage.mock.calls).toEqual([
      [{ action: 'copy-text', input: { text: 'a local note' } }],
      [{ action: 'select-project-directories', input: { defaultPath: '/projects' } }],
    ])
    expect(await native.openWorkbenchTool!('editor')).toBe('sidecar-result')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/__craft_hub_host/open-workbench-tool', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-craft-hub-host': '1' },
      body: JSON.stringify({ toolId: 'editor' }),
    })
    expect(Object.isFrozen(native)).toBe(true)
  })

  it('propagates OS and sidecar rejections instead of claiming success', async () => {
    const { native, postMessage, fetch } = await loadBridges()
    postMessage.mockRejectedValueOnce(new Error('The runtime is busy'))
    await expect(native.restartForHostExtensions!()).rejects.toThrow('The runtime is busy')
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ value: undefined, error: 'Unknown workbench tool' }) })
    await expect(native.openWorkbenchTool!('missing')).rejects.toThrow('Unknown workbench tool')
  })

  it('passes project and workspace identifiers to host launch routes without inventing local paths', async () => {
    const { native, fetch, postMessage } = await loadBridges()
    await native.openProjectInTerminal!('project', 'Ghostty')
    await native.openProjectEvidenceInEditor!('project', 'src/index.ts', 12, 4)
    await native.openWorkspaceInEditor!('workspace')
    expect(fetch.mock.calls.map((call: unknown[]) => [call[0], JSON.parse((call[1] as { body: string }).body)])).toEqual([
      ['/__craft_hub_host/open-project-in-terminal', { projectId: 'project', application: 'Ghostty' }],
      ['/__craft_hub_host/open-project-evidence-in-editor', { projectId: 'project', path: 'src/index.ts', line: 12, column: 4 }],
      ['/__craft_hub_host/open-workspace-in-editor', { workspaceId: 'workspace' }],
    ])
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('validates a Codex handoff before copying the prompt and opens only after the clipboard succeeds', async () => {
    const { native, fetch, postMessage } = await loadBridges()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { prompt: 'Reviewed prompt' } }) })
    await native.startProjectInCodex!('project', ' Reviewed prompt ', 'packages/core')
    expect(fetch.mock.calls.map((call: unknown[]) => [call[0], JSON.parse((call[1] as { body: string }).body)])).toEqual([
      ['/__craft_hub_host/prepare-project-codex-handoff', { projectId: 'project', prompt: ' Reviewed prompt ', packageRelativePath: 'packages/core' }],
      ['/__craft_hub_host/open-project-in-codex', { projectId: 'project', packageRelativePath: 'packages/core' }],
    ])
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ action: 'copy-text', input: { text: 'Reviewed prompt' } })
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(postMessage.mock.invocationCallOrder[0])
    expect(postMessage.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[1])
    fetch.mockClear()
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Outside project' }) })
    postMessage.mockClear()
    await expect(native.startProjectInCodex!('project', 'prompt', '..')).rejects.toThrow('Outside project')
    expect(postMessage).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockClear()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { prompt: 'Reviewed prompt' } }) })
    postMessage.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await expect(native.startProjectInCodex!('project', 'prompt')).rejects.toThrow('Clipboard unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
