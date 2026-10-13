import type { SoftwareCatalogManifest } from './software-catalog'
import { createHash } from 'node:crypto'
import { softwareCatalogManifestSchema } from './software-catalog'

/** Validate a parsed cache and check its content revision. */
export function parseSoftwareCatalogManifest(input: unknown): SoftwareCatalogManifest {
  const catalog = softwareCatalogManifestSchema.parse(input)
  const { version, source, items } = catalog
  const revision = createHash('sha256').update(JSON.stringify({ version, source, items })).digest('hex')
  if (revision !== catalog.revision)
    throw new Error('Software catalog revision does not match its contents. Refresh it from the upstream source.')
  return catalog
}
