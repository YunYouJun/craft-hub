import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { projectConfigJsonSchema } from '../packages/craft-hub/src/project-config-schema'

const schemaPath = fileURLToPath(new URL('../packages/craft-hub/schema/project-v1.schema.json', import.meta.url))
const revisionPath = fileURLToPath(new URL('../packages/craft-hub/src/project-config-schema-revision.ts', import.meta.url))
const content = `${JSON.stringify(projectConfigJsonSchema(), null, 2)}\n`
const revision = createHash('sha256').update(content).digest('hex')
const revisionContent = `/** Generated fingerprint of the bundled project configuration schema. */\nexport const projectConfigSchemaRevision = 'sha256:${revision}' as const\n`

if (process.argv.includes('--check')) {
  const [current, currentRevision] = await Promise.all([
    readFile(schemaPath, 'utf8').catch(() => ''),
    readFile(revisionPath, 'utf8').catch(() => ''),
  ])
  if (current !== content || currentRevision !== revisionContent)
    throw new Error('Project configuration schema is stale. Run pnpm schema:project.')
}
else {
  await Promise.all([
    writeFile(schemaPath, content, 'utf8'),
    writeFile(revisionPath, revisionContent, 'utf8'),
  ])
}
