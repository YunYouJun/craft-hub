import type { DevframeDefinition } from 'devframe'
import type { InspectorReader } from './types.ts'
import { fileURLToPath } from 'node:url'
import { defineDevframe, defineRpcFunction } from 'devframe'
import pkg from '../package.json' with { type: 'json' }
import { inspectorLogo } from './branding.ts'
import { createInspectorReader, projectIdSchema } from './reader.ts'

/** Define Craft Hub's read-only development inspector over the existing local API. */
export function createCraftHubDevframe(reader: InspectorReader = createInspectorReader()): DevframeDefinition {
  return defineDevframe({
    id: 'craft-hub',
    name: 'Craft Hub Inspector',
    version: pkg.version,
    packageName: pkg.name,
    importMetaUrl: import.meta.url,
    homepage: 'https://github.com/YunYouJun/craft-hub',
    description: 'Inspect project trust, discovered capabilities, diagnostics, and recent runs.',
    icon: inspectorLogo,
    basePath: '/__craft-hub/',
    clientAssets: fileURLToPath(new URL('./client', import.meta.url)),
    capabilities: { dev: true, build: false },
    setup(ctx) {
      ctx.rpc.register(defineRpcFunction({
        name: 'craft-hub:snapshot',
        type: 'query',
        cacheable: false,
        handler: reader.snapshot,
      }))
      ctx.rpc.register(defineRpcFunction({
        name: 'craft-hub:discover',
        type: 'query',
        cacheable: false,
        handler: (projectId: string) => reader.discover(projectIdSchema.parse(projectId)),
      }))
    },
  })
}
