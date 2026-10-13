import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { workspaceSourceJsonSchema } from '../packages/craft-hub/src/workspace-source'

const schemaPath = fileURLToPath(new URL('../packages/craft-hub/schema/workspace-source-v1.schema.json', import.meta.url))
const content = `${JSON.stringify(workspaceSourceJsonSchema(), null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = await readFile(schemaPath, 'utf8').catch(() => '')
  if (current.replaceAll('\r\n', '\n') !== content)
    throw new Error('Workspace source schema is stale. Run pnpm schema:source.')
}
else {
  await writeFile(schemaPath, content, 'utf8')
}
