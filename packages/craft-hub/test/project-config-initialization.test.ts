import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectConfigJsonSchema, projectConfigSchema, projectConfigSchemaUrl } from '../src/config'
import { CraftHubRuntime } from '../src/runtime'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-project-config-'))
  const runtime = new CraftHubRuntime(join(root, '.data'))
  const project = await runtime.addProject(root)
  return { configPath: join(root, '.craft-hub', 'project.jsonc'), project, root, runtime }
}

describe('project config initialization', () => {
  it('accepts positional text inputs and rejects ambiguous flag combinations', () => {
    const config = (input: Record<string, unknown>) => ({
      version: 1,
      capabilities: { inputs: { 'package.json:logs': { pipelineId: input } } },
    })

    expect(projectConfigSchema.safeParse(config({
      type: 'text',
      argumentStyle: 'positional',
      required: true,
    })).success).toBe(true)
    expect(projectConfigSchema.safeParse(config({
      type: 'text',
      argumentStyle: 'positional',
      flag: '--pipeline',
    })).success).toBe(false)
    expect(projectConfigSchema.safeParse(config({ type: 'text' })).success).toBe(false)
  })

  it('previews without writing and requires trust before applying', async () => {
    const fixture = await setup()
    try {
      const preview = await fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview')
      expect(preview).toMatchObject({
        projectId: fixture.project.id,
        targetPath: '.craft-hub/project.jsonc',
        trust: 'untrusted',
        exists: false,
        mode: 'preview',
        outcome: 'preview',
      })
      expect(preview.content).toContain('"version": 1')
      expect(preview.content).toContain(`"name": "${fixture.project.name}"`)
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
        '{',
        '  // created externally',
        '  "version": 1,',
        '  "extensions": { "example.workflow": { "owner": "downstream" } }',
        '}',
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
      await expect(access(join(external, 'project.jsonc'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally {
      await fixture.runtime.close()
    }
  })

  it('requires explicit version 1 and rejects unknown core keys', async () => {
    const fixture = await setup()
    try {
      await mkdir(join(fixture.root, '.craft-hub'), { recursive: true })
      await writeFile(fixture.configPath, '{ "project": { "name": "Missing version" } }\n')
      await expect(fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview'))
        .rejects
        .toThrow('/version')

      await writeFile(fixture.configPath, '{ "version": 1, "workflow": {} }\n')
      await expect(fixture.runtime.initializeProjectConfig(fixture.project.id, 'preview'))
        .rejects
        .toThrow('Unrecognized key: "workflow"')
    }
    finally {
      await fixture.runtime.close()
    }
  })

  it('ships a generated schema that matches the Zod source of truth', async () => {
    const schemaPath = join(import.meta.dirname, '..', 'schema', 'project-v1.schema.json')
    expect(JSON.parse(await readFile(schemaPath, 'utf8'))).toEqual(projectConfigJsonSchema())
    expect(projectConfigSchemaUrl).toContain('/project-v1.schema.json')
  })

  it('preserves JSONC comments and downstream fields when updating project visuals', async () => {
    const fixture = await setup()
    try {
      await mkdir(join(fixture.root, '.craft-hub'), { recursive: true })
      await writeFile(fixture.configPath, [
        '{',
        '  // downstream metadata stays intact',
        '  "version": 1,',
        '  "extensions": { "example.workflow": { "owner": "downstream" } },',
        '}',
        '',
      ].join('\n'))

      await fixture.runtime.projects.setTrust(fixture.project.id, 'trusted')
      await fixture.runtime.projects.setVisual(fixture.project.id, { icon: 'emoji:🚀', color: 'purple' })
      const content = await readFile(fixture.configPath, 'utf8')

      expect(content).toContain('// downstream metadata stays intact')
      expect(content).toContain('"owner": "downstream"')
      expect(content).toContain('"icon": "emoji:🚀"')
      expect(content).toContain('"color": "purple"')
    }
    finally {
      await fixture.runtime.close()
    }
  })
})
