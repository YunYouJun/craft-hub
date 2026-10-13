import { readFileSync } from 'node:fs'
import { parseSoftwareConfig, workstationCatalogSource } from './software-config'

/** Offline TS snapshot shipped as text, parsed without importing or executing its module. */
export const bundledSoftwareCatalog = parseSoftwareConfig(
  readFileSync(new URL('../catalogs/workstation.config.ts', import.meta.url), 'utf8'),
  workstationCatalogSource,
)
