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
  const script = swift.match(/static let script = """\n([\s\S]*?)\n {2}"""/)?.[1]
  if (!script)
    throw new Error('The native bridge injection script was not found')
  const window = { webkit: { messageHandlers: { craftHubBridge: { postMessage } } } } as unknown as Window
  runInNewContext(script.replaceAll('\\(handlerName)', 'craftHubBridge'), { window, fetch })
  return { electron, native: window.craftHubDesktop!, invoke, postMessage, fetch }
}

describe('versioned desktop bridge contract', () => {
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
    expect(native.startProjectInCodex).toBeUndefined()
  })

  it('propagates OS and sidecar rejections instead of claiming success', async () => {
    const { native, postMessage, fetch } = await loadBridges()
    postMessage.mockRejectedValueOnce(new Error('The runtime is busy'))
    await expect(native.restartForHostExtensions!()).rejects.toThrow('The runtime is busy')
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ value: undefined, error: 'Unknown workbench tool' }) })
    await expect(native.openWorkbenchTool!('missing')).rejects.toThrow('Unknown workbench tool')
  })
})
