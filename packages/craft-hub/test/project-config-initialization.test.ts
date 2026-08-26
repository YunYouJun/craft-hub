import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-project-config-'))
  const runtime = new CraftHubRuntime(join(root, '.data'))
  const project = await runtime.addProject(root)
  return { configPath: join(root, '.craft-hub', 'project.yaml'), project, root, runtime }
}

describe('project config initialization', () => {
  it('previews without writing and requires trust before applying', async () => {
    const fixture = await setup()
    try {
      const preview = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview')
      expect(preview).toMatchObject({
        projectId: fixture.project.id,
        targetPath: '.craft-hub/project.yaml',
        trust: 'untrusted',
        exists: false,
        mode: 'preview',
        outcome: 'preview',
      })
      expect(preview.content).toContain('version: 1')
      expect(preview.content).toContain(`name: ${fixture.project.name}`)
      await expect(access(fixture.configPath)).rejects.toMatchObject({ code: 'ENOENT' })

      await expect(fixture.runtime.initializeProjectConfig(fixture.project.id, 'apply', preview.revision))
        .rejects
        .toThrow('untrusted')
      await expect(access(fixture.configPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally {
      await fixture.runtime.close()
    }
  })

  it('creates the previewed file once and leaves existing content unchanged', async () => {
    const fixture = await setup()
    try {
      await fixture.runtime.projects.setTrust(fixture.project.id, 'trusted')
      const preview = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview')
      const applied = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'apply', preview.revision)

      expect(applied).toMatchObject({ trust: 'trusted', exists: true, outcome: 'created' })
      expect(await readFile(fixture.configPath, 'utf8')).toBe(preview.content)

      const existing = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview')
      const unchanged = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'apply', existing.revision)
      expect(unchanged).toMatchObject({ exists: true, outcome: 'unchanged', content: preview.content })
    }
    finally {
      await fixture.runtime.close()
    }
  })

  it('detects changes after preview without overwriting repository content', async () => {
    const fixture = await setup()
    try {
      await fixture.runtime.projects.setTrust(fixture.project.id, 'trusted')
      const preview = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview')
      const externalContent = [
        '# created externally',
        'version: 1',
        'workflow:',
        '  owner: downstream',
        '',
      ].join('\n')
      await mkdir(join(fixture.root, '.craft-hub'), { recursive: true })
      await writeFile(fixture.configPath, externalContent)

      await expect(fixture.runtime.initializeProjectConfig(fixture.project.id, 'apply', preview.revision))
        .rejects
        .toThrow('changed after preview')
      expect(await readFile(fixture.configPath, 'utf8')).toBe(externalContent)
    }
    finally {
      await fixture.runtime.close()
    }
  })

  it('refuses to initialize through a config directory symlink outside the project', async () => {
    const fixture = await setup()
    const external = await mkdtemp(join(tmpdir(), 'craft-hub-external-config-'))
    try {
      await symlink(external, join(fixture.root, '.craft-hub'), process.platform === 'win32' ? 'junction' : 'dir')
      await fixture.runtime.projects.setTrust(fixture.project.id, 'trusted')
      const preview = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview')

      await expect(fixture.runtime.initializeProjectConfig(fixture.project.id, 'apply', preview.revision))
        .rejects
        .toThrow('must stay inside the project directory')
      await expect(fixture.runtime.projects.setVisual(fixture.project.id, { icon: 'emoji:🚀' }))
        .rejects
        .toThrow('must stay inside the project directory')
      await expect(access(join(external, 'project.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally {
      await fixture.runtime.close()
    }
  })
})
