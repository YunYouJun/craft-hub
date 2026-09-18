import type { Plugin } from 'vite'
import { createPluginFromDevframe } from '@vitejs/devtools-kit/node'
import { inspectorLogo } from './branding.ts'
import { createCraftHubDevframe } from './definition.ts'
import { inspectorFrameId, inspectorGroupId, inspectorTabs } from './navigation.ts'

/** Mount the inspector in the official Vite DevTools dock during development. */
export function craftHubDevtools(): Plugin {
  return {
    ...createPluginFromDevframe(createCraftHubDevframe(), {
      dock: {
        category: 'app',
        groupId: inspectorGroupId,
        frameId: inspectorFrameId,
        clientScript: { importFrom: '/src/devtools/dock-client.ts' },
        visibility: 'false',
      },
      setup(ctx) {
        ctx.docks.register({
          type: 'group',
          id: inspectorGroupId,
          title: 'Craft Hub Inspector',
          icon: inspectorLogo,
          category: 'app',
          defaultChildId: `${inspectorFrameId}:projects`,
        })
        // Seed deep links before the iframe boots; its manifest supplies live titles.
        for (const [order, tab] of inspectorTabs.entries()) {
          ctx.docks.register({
            type: 'iframe',
            id: `${inspectorFrameId}:${tab.id}`,
            title: tab.title,
            icon: tab.icon,
            groupId: inspectorGroupId,
            frameId: inspectorFrameId,
            defaultOrder: order,
            url: `/__craft-hub/#/${tab.id}`,
            navTarget: { path: `/${tab.id}` },
            // Restored child entries can mount before the hidden anchor ever opens.
            clientScript: { importFrom: '/src/devtools/dock-client.ts' },
          })
        }
      },
    }),
    apply: 'serve' as const,
  }
}
