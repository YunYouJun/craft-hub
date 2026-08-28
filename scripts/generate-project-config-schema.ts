import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { projectConfigJsonSchema } from '../packages/craft-hub/src/project-config-schema'

const schemaPath = fileURLToPath(new URL('../packages/craft-hub/schema/project-v1.schema.json', import.meta.url))
const content = `${JSON.stringify(projectConfigJsonSchema(), null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = await readFile(schemaPath, 'utf8').catch(() => '')
  if (current !== content)
    throw new Error('Project configuration schema is stale. Run pnpm schema:project.')
}
else {
  await writeFile(schemaPath, content, 'utf8')
}
