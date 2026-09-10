import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  deps: {
    neverBundle: ['electron', 'craft-hub'],
    alwaysBundle: ['@craft-hub/craft-hub-plugin-workstation'],
  },
  platform: 'node',
})
