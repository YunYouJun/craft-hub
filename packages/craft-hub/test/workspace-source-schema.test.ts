import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWorkspaceSource, sourceWorkspaceSchemaUrl, workspaceSourceJsonSchema, workspaceSourceSchemaUrl } from '../src/workspace-source'

const workspace = {
  schemaVersion: 1,
  id: 'development',
  name: 'Development',
  primaryProject: 'https://git.example.com/team/project.git',
  members: [{ project: 'https://git.example.com/team/project' }],
}
const source = { schemaVersion: 1, id: 'example', name: 'Example source', workspaces: [workspace] }

describe('workspace source schema', () => {
  it('keeps legacy bundles and workspace directories valid', () => {
    expect(readWorkspaceSource({ 'source.json': JSON.stringify(source) })).toMatchObject({
      id: 'example',
      workspaces: [{ id: 'development', primaryProject: 'https://git.example.com/team/project' }],
    })
    expect(readWorkspaceSource({ 'workspaces/development.jsonc': `// shared definition\n${JSON.stringify(workspace)}` })).toMatchObject({
      id: 'workspaces',
      workspaces: [{ id: 'development' }],
    })
  })

  it('accepts schema hints without resolving them', () => {
    const withHints = { ...source, $schema: workspaceSourceSchemaUrl, workspaces: [{ ...workspace, $schema: sourceWorkspaceSchemaUrl }] }
    expect(readWorkspaceSource({ 'source.jsonc': JSON.stringify(withHints) })).toMatchObject({
      ...withHints,
      workspaces: [{ ...withHints.workspaces[0], primaryProject: 'https://git.example.com/team/project' }],
    })
    expect(readWorkspaceSource({ 'development.json': JSON.stringify({ ...workspace, $schema: '../schema/workspace-source-v1.schema.json#/$defs/workspace' }) }).workspaces[0]?.$schema).toBe('../schema/workspace-source-v1.schema.json#/$defs/workspace')
    expect(readWorkspaceSource({ 'source.json': JSON.stringify({ ...source, $schema: 'https://unavailable.example/schema.json' }) }).$schema).toBe('https://unavailable.example/schema.json')
  })

  it('still rejects unknown fields and execution or owner metadata', () => {
    for (const extra of [{ ownerScopeId: 'private' }, { path: '/tmp/project' }, { command: 'execute' }, { trust: 'trusted' }]) {
      expect(() => readWorkspaceSource({ 'source.json': JSON.stringify({ ...source, ...extra }) })).toThrow()
      expect(() => readWorkspaceSource({ 'development.json': JSON.stringify({ ...workspace, ...extra }) })).toThrow()
    }
    expect(() => readWorkspaceSource({ 'source.json': JSON.stringify({ ...source, $schema: 1 }) })).toThrow()
  })

  it('still rejects unsafe or malformed repository references', () => {
    for (const project of [
      'file:///tmp/project',
      '/tmp/project',
      'http://git.example.com/team/project',
      'ssh://git@git.example.com/team/project',
      'https://user:secret@git.example.com/team/project',
      'https://git.example.com/team/project?token=secret',
      'https://git.example.com/team/project#branch',
      'https://git.example.com',
      'https://git.example.com/team/%2Fproject',
    ]) {
      expect(() => readWorkspaceSource({ 'development.json': JSON.stringify({ ...workspace, members: [{ project }] }) })).toThrow()
      expect(() => readWorkspaceSource({ 'development.json': JSON.stringify({ ...workspace, primaryProject: project }) })).toThrow()
    }
  })

  it('preserves semantic constraints beyond the generated editor schema', () => {
    expect(() => readWorkspaceSource({ 'source.json': JSON.stringify({ ...source, workspaces: [workspace, workspace] }) })).toThrow('Duplicate workspace ids')
    expect(() => readWorkspaceSource({ 'development.json': JSON.stringify({ ...workspace, members: [...workspace.members, { project: 'https://git.example.com/team/project.git' }] }) })).toThrow('Duplicate project references')
    expect(() => readWorkspaceSource({ 'development.json': JSON.stringify({ ...workspace, primaryProject: 'https://git.example.com/team/other' }) })).toThrow('Primary project must be a member')
  })

  it('treats empty manifests as present instead of accepting a second bundle or falling back', () => {
    expect(() => readWorkspaceSource({ 'source.json': '', 'source.jsonc': JSON.stringify(source) })).toThrow('Publish only one source manifest')
    expect(() => readWorkspaceSource({ 'source.json': JSON.stringify(source), 'source.jsonc': '' })).toThrow('Publish only one source manifest')
    expect(() => readWorkspaceSource({ 'source.jsonc': '', 'development.json': JSON.stringify(workspace) })).toThrow()
  })

  it('ships a stable offline schema with the complete strict workspace structure', async () => {
    const content = await readFile(join(import.meta.dirname, '..', 'schema', 'workspace-source-v1.schema.json'), 'utf8')
    const schema = workspaceSourceJsonSchema()
    expect(content).toBe(`${JSON.stringify(schema, null, 2)}\n`)
    expect(workspaceSourceJsonSchema()).toEqual(schema)
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: workspaceSourceSchemaUrl,
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'id', 'name', 'workspaces'],
      properties: {
        $schema: { type: 'string' },
        schemaVersion: { const: 1 },
        workspaces: { type: 'array', maxItems: 200, items: { $ref: '#/$defs/workspace' } },
      },
      $defs: {
        workspace: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'id', 'name', 'members'],
          properties: {
            $schema: { type: 'string' },
            schemaVersion: { const: 1 },
            members: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['project'] } },
          },
        },
      },
    })
    const externalReferences = JSON.stringify(schema).match(/"\$ref":"[^#][^"]*"/g)
    expect(externalReferences).toBeNull()
  })
})
