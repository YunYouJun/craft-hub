import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { RuntimeDocumentSource } from '../src/runtime-documents'

describe('runtime cloud documents', () => {
  it('keeps settings revision stable when only export time changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-cloud-documents-'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const revisions = new Map<string, string>()
    const source = new RuntimeDocumentSource(runtime, {
      get: async key => revisions.get(key),
      set: async (key, revision) => void revisions.set(key, revision),
    })

    const first = (await source.documents()).find(document => document.key === 'settings/global')!
    await new Promise(resolve => setTimeout(resolve, 2))
    const second = (await source.documents()).find(document => document.key === 'settings/global')!

    expect(first.payload).not.toEqual(second.payload)
    expect(first.revision).toBe(second.revision)
    expect(JSON.stringify(first.payload)).not.toContain(runtime.store.dataDir)
    await runtime.close()
  })
})
