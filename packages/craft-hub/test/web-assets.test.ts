import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { resolveCraftHubWebDirectory } from '../src/web-assets'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('prefers packaged assets and supports a built checkout without silently serving an empty UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-assets-'))
  roots.push(root)
  const packageRoot = join(root, 'packages/craft-hub')
  expect(() => resolveCraftHubWebDirectory(packageRoot)).toThrow('Web assets are missing')
  const checkout = join(root, 'apps/web/dist')
  await mkdir(checkout, { recursive: true })
  await writeFile(join(checkout, 'index.html'), '<html>checkout</html>')
  expect(resolveCraftHubWebDirectory(packageRoot)).toBe(checkout)
  const packaged = join(packageRoot, 'web')
  await mkdir(packaged, { recursive: true })
  await writeFile(join(packaged, 'index.html'), '<html>package</html>')
  expect(resolveCraftHubWebDirectory(packageRoot)).toBe(packaged)
})

it('returns JSON 404 for unknown APIs while serving client-side Web routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-web-routing-'))
  roots.push(root)
  await writeFile(join(root, 'index.html'), '<html>workbench</html>')
  const server = await startCraftHubServer({ port: 0, staticDir: root, runtime: new CraftHubRuntime(join(root, 'data')) })
  try {
    const missing = await fetch(new URL('/api/removed-resource', server.url))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Not found' })
    expect(await fetch(new URL('/navigation', server.url)).then(response => response.text())).toContain('workbench')
  }
  finally {
    await server.close()
  }
})
