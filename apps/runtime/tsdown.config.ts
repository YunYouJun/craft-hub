import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/worker.ts'],
  platform: 'node',
  deps: { neverBundle: ['craft-hub'] },
})
