import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  deps: {
    neverBundle: ['electron', 'craft-hub'],
  },
  platform: 'node',
})
