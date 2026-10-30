import { defineConfig } from 'tsdown'

export default defineConfig({
  // The sidecar serves the same runtime to the native macOS host; it must not import Electron.
  entry: ['src/main.ts', 'src/sidecar.ts', 'src/node-network-bootstrap.ts'],
  deps: {
    neverBundle: ['electron', 'craft-hub'],
    alwaysBundle: ['@craft-hub/craft-hub-plugin-workstation'],
  },
  platform: 'node',
})
