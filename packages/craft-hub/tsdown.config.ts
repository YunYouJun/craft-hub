import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { defineConfig } from 'tsdown'

const buildSignalPath = process.env.CRAFT_HUB_DEV_BUILD_SIGNAL

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli.ts',
    'src/project-config-schema-revision.ts',
    'src/skill-inputs.ts',
  ],
  dts: true,
  exports: true,
  publint: true,
  onSuccess: buildSignalPath ? () => writeFile(buildSignalPath, randomUUID(), 'utf8') : undefined,
})
