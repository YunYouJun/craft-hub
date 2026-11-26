import type { CraftHubPlugin, CraftHubServer } from '../src/index'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CraftHubRuntime, startCraftHubServer } from '../src/index'

const tempDirs: string[] = []
const servers: CraftHubServer[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map(server => server.close()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('document spaces HTTP server & host workbenches', () => {
  it('supports document space CRUD, 409 conflicts, SVG asset sandboxing, and SSE watch events', async () => {
    const dataDir = await createTempDir('craft-hub-ds-srv-data-')
    const spaceRoot = await createTempDir('craft-hub-ds-srv-root-')
    await writeFile(join(spaceRoot, 'hello.md'), '# Hello\n\nInitial content.\n', 'utf8')
    await writeFile(join(spaceRoot, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>', 'utf8')

    const runtime = new CraftHubRuntime({ dataDir })
    const server = await startCraftHubServer({ port: 0, runtime })
    servers.push(server)

    const crossSite = await fetch(`${server.url}/api/document-spaces/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ path: spaceRoot }),
    })
    expect(crossSite.status).toBe(403)

    const added = await fetch(`${server.url}/api/document-spaces/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: spaceRoot, title: 'Workspace Notes' }),
    })
    expect(added.status).toBe(201)
    const space = await added.json() as { id: string, title: string }
    expect(space.title).toBe('Workspace Notes')

    const listRes = await fetch(`${server.url}/api/document-spaces`)
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toHaveLength(1)

    const nodesRes = await fetch(`${server.url}/api/document-spaces/${space.id}/nodes`)
    expect(nodesRes.status).toBe(200)
    expect(await nodesRes.json()).toMatchObject([{ path: 'hello.md', title: 'Hello' }])

    const docRes = await fetch(`${server.url}/api/document-spaces/${space.id}/document?path=hello.md`)
    expect(docRes.status).toBe(200)
    const doc = await docRes.json() as { revision: string, markdown: string }

    const saveRes = await fetch(`${server.url}/api/document-spaces/${space.id}/document`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'hello.md',
        markdown: '# Hello\n\nUpdated via API.\n',
        expectedRevision: doc.revision,
      }),
    })
    expect(saveRes.status).toBe(200)

    const conflictRes = await fetch(`${server.url}/api/document-spaces/${space.id}/document`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'hello.md',
        markdown: '# Hello\n\nStale overwrite.\n',
        expectedRevision: doc.revision,
      }),
    })
    expect(conflictRes.status).toBe(409)
    const conflictBody = await conflictRes.json() as { status: string, current: { markdown: string } }
    expect(conflictBody.status).toBe('conflict')
    expect(conflictBody.current.markdown).toContain('Updated via API.')

    const createdRes = await fetch(`${server.url}/api/document-spaces/${space.id}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'guide', kind: 'bundle', title: 'Guide Bundle' }),
    })
    expect(createdRes.status).toBe(201)
    expect(await createdRes.json()).toMatchObject({ path: 'guide/index.md', title: 'Guide Bundle' })

    const movedRes = await fetch(`${server.url}/api/document-spaces/${space.id}/documents/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromPath: 'hello.md', toPath: 'guide/hello.md' }),
    })
    expect(movedRes.status).toBe(200)
    expect(await movedRes.json()).toMatchObject({ path: 'guide/hello.md' })

    const dailyRes = await fetch(`${server.url}/api/document-spaces/${space.id}/daily`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-27' }),
    })
    expect(dailyRes.status).toBe(200)
    expect(await dailyRes.json()).toMatchObject({ path: 'daily/2026-11-27.md' })

    const svgRes = await fetch(`${server.url}/api/document-spaces/${space.id}/asset?path=diagram.svg`)
    expect(svgRes.status).toBe(200)
    expect(svgRes.headers.get('content-type')).toBe('image/svg+xml')
    expect(svgRes.headers.get('content-security-policy')).toContain('sandbox')
    expect(svgRes.headers.get('x-content-type-options')).toBe('nosniff')

    // Subscribe to /api/events and confirm external edits broadcast document-space-change.
    const sseAbort = new AbortController()
    const sseResponse = await fetch(`${server.url}/api/events`, { signal: sseAbort.signal })
    const reader = sseResponse.body!.pipeThrough(new TextDecoderStream()).getReader()
    await writeFile(join(spaceRoot, 'guide', 'hello.md'), '# Hello\n\nExternal disk update.\n', 'utf8')

    let sseBuffer = ''
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !sseBuffer.includes('event: document-space-change')) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true, value: undefined }>(resolve => setTimeout(resolve, 500, { done: true, value: undefined })),
      ])
      if (chunk.value)
        sseBuffer += chunk.value
      if (chunk.done && !chunk.value)
        continue
    }
    sseAbort.abort()
    await reader.cancel().catch(() => {})
    expect(sseBuffer).toContain('event: document-space-change')
    expect(sseBuffer).toContain('guide/hello.md')

    const delDocRes = await fetch(`${server.url}/api/document-spaces/${space.id}/document?path=daily%2F2026-11-27.md`, { method: 'DELETE' })
    expect(delDocRes.status).toBe(200)

    const delSpaceRes = await fetch(`${server.url}/api/document-spaces/local/${space.id}`, { method: 'DELETE' })
    expect(delSpaceRes.status).toBe(200)
  })

  it('merges host-contributed workbenches and plugin documentSpaceProviders', async () => {
    const dataDir = await createTempDir('craft-hub-ds-plugin-data-')
    const plugin: CraftHubPlugin = {
      id: '@acme/craft-hub-plugin-notes',
      name: 'Acme Notes',
      version: '0.1.0',
      documentSpaceProviders: [
        {
          id: 'acme-notes',
          listSpaces: async () => [{
            id: 'acme-space',
            title: 'Acme Space',
            providerId: 'acme-notes',
            kind: 'plugin',
            capabilities: { create: false, write: false, delete: false, move: false, snapshot: false, resolveAsset: true },
          }],
          listNodes: async () => [{ path: 'intro.md', name: 'intro.md', title: 'Intro', kind: 'document' }],
          readDocument: async (spaceId, docPath) => ({
            spaceId,
            path: docPath,
            title: 'Intro',
            frontmatter: {},
            markdown: '# Intro',
            rawContent: '# Intro',
            revision: 'rev-1',
            updatedAt: '2026-11-27T00:00:00.000Z',
            readOnly: true,
            cards: [],
            breadcrumbs: [{ path: docPath, title: 'Intro' }],
          }),
          resolveAsset: async () => ({
            content: Buffer.from([1, 2, 3]),
            mimeType: 'image/png',
            sha256: 'abc',
            filename: 'pixel.png',
          }),
        },
      ],
      workbenches: [
        {
          id: 'editorial',
          title: { 'default': 'Editorial', 'zh-CN': '编辑工作台' },
          icon: 'builtin:docs',
          views: [{ type: 'host', view: 'document-spaces', group: { 'default': 'Writing', 'zh-CN': '写作' } }],
        },
      ],
    }

    const runtime = new CraftHubRuntime({ dataDir, plugins: [plugin] })
    const server = await startCraftHubServer({ port: 0, runtime })
    servers.push(server)

    const workbenchesRes = await fetch(`${server.url}/api/workbenches?locale=zh-CN`)
    expect(workbenchesRes.status).toBe(200)
    expect(await workbenchesRes.json()).toMatchObject([
      {
        id: 'editorial',
        pluginId: '@acme/craft-hub-plugin-notes',
        title: '编辑工作台',
        views: [{ type: 'host', view: 'document-spaces', group: '写作' }],
      },
    ])

    const spacesRes = await fetch(`${server.url}/api/document-spaces`)
    expect(spacesRes.status).toBe(200)
    expect(await spacesRes.json()).toMatchObject([{ id: 'acme-space', kind: 'plugin', providerId: 'acme-notes' }])

    const docRes = await fetch(`${server.url}/api/document-spaces/acme-space/document?path=intro.md`)
    expect(docRes.status).toBe(200)
    expect(await docRes.json()).toMatchObject({ spaceId: 'acme-space', path: 'intro.md', readOnly: true })
  })
})
