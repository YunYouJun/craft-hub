import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Locate the host-owned Web UI in an installed package or a development checkout. */
export function resolveCraftHubWebDirectory(packageRoot = fileURLToPath(new URL('../', import.meta.url))): string {
  for (const directory of [resolve(packageRoot, 'web'), resolve(packageRoot, '../../apps/web/dist')]) {
    if (existsSync(resolve(directory, 'index.html')))
      return directory
  }
  throw new Error('Craft Hub Web assets are missing. Run "pnpm build" in the community checkout or reinstall a complete craft-hub package.')
}
