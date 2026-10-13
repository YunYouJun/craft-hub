import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseSoftwareConfig, workstationCatalogSource } from '../packages/craft-hub/src/software-config'

const snapshotPath = fileURLToPath(new URL('../packages/craft-hub/catalogs/workstation.config.ts', import.meta.url))

/** Validate the upstream TypeScript before replacing the bundled snapshot. */
export async function syncSoftwareCatalog(inputPath: string, outputPath = snapshotPath): Promise<void> {
  const content = await readFile(inputPath, 'utf8')
  parseSoftwareConfig(content, workstationCatalogSource)
  await mkdir(dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, outputPath)
  }
  finally { await rm(temporary, { force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, ...extra] = process.argv.slice(2)
  if (!input || extra.length)
    throw new Error('Usage: pnpm software-catalog:sync <software.config.ts> | --check')
  if (input === '--check') {
    const content = await readFile(snapshotPath, 'utf8')
    parseSoftwareConfig(content, workstationCatalogSource)
  }
  else {
    await syncSoftwareCatalog(resolve(input))
    console.log(`Updated ${snapshotPath}`)
  }
}
