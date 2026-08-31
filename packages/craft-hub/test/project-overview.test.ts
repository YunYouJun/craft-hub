import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readProjectOverviewAsset, readProjectReadme } from '../src/project-overview'

describe('project overview files', () => {
  it('discovers a case-insensitive package README and returns bounded UTF-8 Markdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-overview-'))
    const packageDirectory = join(root, 'apps', 'widget')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(join(packageDirectory, 'readme.MD'), '# Widget\n\nPackage documentation.')

    await expect(readProjectReadme(root, { relativePath: 'apps/widget', root: false })).resolves.toEqual({
      status: 'found',
      path: 'apps/widget/readme.MD',
      content: '# Widget\n\nPackage documentation.',
    })
  })

  it('rejects configured README paths and symlinks that cannot be contained by the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-overview-invalid-'))
    await expect(readProjectReadme(root, { relativePath: '.', root: true, readme: '../README.md' })).resolves.toMatchObject({
      status: 'invalid',
      message: 'Configured README path resolves outside the project.',
    })
  })

  it('serves only bounded raster assets inside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-overview-asset-'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'preview.png'), Buffer.from([137, 80, 78, 71]))
    await writeFile(join(root, 'docs', 'active.svg'), '<svg/>')

    await expect(readProjectOverviewAsset(root, 'docs/preview.png')).resolves.toMatchObject({ contentType: 'image/png' })
    await expect(readProjectOverviewAsset(root, 'docs/active.svg')).resolves.toBeUndefined()
    await expect(readProjectOverviewAsset(root, '../preview.png')).resolves.toBeUndefined()
  })
})
