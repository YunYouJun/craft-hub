import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import unoConfig from './uno.config.ts'

export default defineConfig({
  plugins: [vue(), UnoCSS(unoConfig)],
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
      '/api/agent-connection': {
        target: 'http://127.0.0.1:4318',
        changeOrigin: true,
        bypass(request) {
          // Preserve the host's same-origin requirement through the local dev proxy.
          const host = request.headers.host
          const hosts = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`]
          if (!hosts.includes(host ?? '') || request.headers['sec-fetch-site'] === 'cross-site'
            || (request.headers.origin && request.headers.origin !== `http://${host}`)) {
            return false
          }
          if (request.headers.origin)
            request.headers.origin = 'http://127.0.0.1:4318'
        },
      },
      '/api': 'http://127.0.0.1:4318',
    },
  },
})
