import type { ProxyOptions } from 'vite'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import { craftHubDevtools } from './devtools/plugin.ts'
import unoConfig from './uno.config.ts'

/** Preserve the host's same-origin requirement for local-only routes through the dev proxy. */
const localOnly: ProxyOptions = {
  target: 'http://127.0.0.1:4318',
  changeOrigin: true,
  bypass(request) {
    const host = request.headers.host
    const hosts = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`]
    if (!hosts.includes(host ?? '') || request.headers['sec-fetch-site'] === 'cross-site'
      || (request.headers.origin && request.headers.origin !== `http://${host}`)) {
      return false
    }
    if (request.headers.origin)
      request.headers.origin = 'http://127.0.0.1:4318'
  },
}

export default defineConfig({
  plugins: [vue(), UnoCSS(unoConfig), craftHubDevtools()],
  resolve: {
    // File previews ship a curated set of Shiki grammars; only the bare `shiki` entry is replaced.
    alias: [{ find: /^shiki$/, replacement: fileURLToPath(new URL('./src/shiki-curated.ts', import.meta.url)) }],
  },
  devtools: {
    apply: 'serve',
    embeddedVisibility: 'passive',
  },
  optimizeDeps: {
    include: [
      '@xterm/addon-fit',
      '@xterm/addon-web-links',
      '@xterm/xterm',
    ],
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/applications': localOnly,
      '/api/application-maintenance': localOnly,
      '/api/work-assistant': localOnly,
      '/api/work-item-projects': localOnly,
      '/api/agent-connection': localOnly,
      '/api/software': localOnly,
      '/api/setup-profile': localOnly,
      '/api/environment/setup': localOnly,
      '/api/environment/sources': localOnly,
      '/api': 'http://127.0.0.1:4318',
    },
  },
})
