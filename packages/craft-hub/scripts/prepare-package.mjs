import { access, cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = new URL('../', import.meta.url)
const source = new URL('../../apps/web/dist/', packageRoot)
const destination = new URL('web/', packageRoot)
await access(new URL('dist/index.mjs', packageRoot)).catch(() => {
  throw new Error('Build Craft Hub before packing: pnpm build')
})
await access(new URL('index.html', source)).catch(() => {
  throw new Error('Build the host Web UI before packing: pnpm build')
})
await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })
console.log(`Packaged Web UI: ${fileURLToPath(destination)}`)
