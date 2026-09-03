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
      '/api': 'http://127.0.0.1:4318',
    },
  },
})
