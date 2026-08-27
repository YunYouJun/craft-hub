import type { ParseError } from 'jsonc-parser'
import type { ProjectRegistry } from './projects'
import type { WorkspaceGroup, WorkspaceImportDiagnostic, WorkspaceImportPreview, WorkspaceImportResult, WorkspaceImportValidation, WorkspaceRecord } from './types'
import type { ImportedWorkspaceMemberInput, WorkspaceService } from './workspaces'
import { createHash } from 'node:crypto'
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'

interface VsCodeWorkspaceFolder {
  name?: unknown
  path?: unknown
  uri?: unknown
}

interface VsCodeWorkspaceFile {
  folders?: unknown
}

interface ParsedWorkspace {
  name: string
  path: string
  members: ImportedWorkspaceMemberInput[]
}

/** Convert external workspace documents into user-owned Craft Hub workspaces. */
export class WorkspaceImportService {
  constructor(
    private readonly projects: ProjectRegistry,
    private readonly workspaces: WorkspaceService,
  ) {}

  /** Validate a one-time VS Code workspace import without changing Craft Hub state. */
  async previewVscodeDirectory(inputDirectory: string, groupName?: string): Promise<WorkspaceImportPreview> {
    const selectedDirectory = await realpath(inputDirectory)
    let sourceDirectory = selectedDirectory
    let names = (await readdir(sourceDirectory)).filter(name => name.endsWith('.code-workspace')).sort()
    if (!names.length) {
      const conventionalDirectory = await realpath(join(selectedDirectory, 'workspaces')).catch(() => undefined)
      if (conventionalDirectory) {
        sourceDirectory = conventionalDirectory
        names = (await readdir(sourceDirectory)).filter(name => name.endsWith('.code-workspace')).sort()
      }
    }
    const diagnostics: WorkspaceImportDiagnostic[] = []
    const projects = await this.projects.list()
    const parsed: ParsedWorkspace[] = []
    if (!names.length) {
      diagnostics.push({
        path: sourceDirectory,
        message: 'No .code-workspace files were found in the selected directory or its workspaces subdirectory',
      })
    }
    for (const name of names) {
      const path = join(sourceDirectory, name)
      const workspace = await this.parseWorkspace(path, projects, diagnostics)
      if (workspace)
        parsed.push(workspace)
    }

    const defaultGroupName = basename(sourceDirectory) === 'workspaces'
      ? basename(dirname(sourceDirectory))
      : basename(sourceDirectory)
    const resolvedGroupName = groupName?.trim() || defaultGroupName
    const [groups, workspaces] = await Promise.all([this.workspaces.groups(), this.workspaces.list()])
    const conflicts = [
      ...(groups.some(group => group.name === resolvedGroupName) ? [`Workspace group already exists: ${resolvedGroupName}`] : []),
      ...parsed.filter(workspace => workspaces.some(existing => existing.name === workspace.name)).map(workspace => `Workspace already exists: ${workspace.name}`),
    ]
    const previewShape = {
      format: 'vscode-workspace' as const,
      sourceDirectory,
      groupName: resolvedGroupName,
      workspaces: parsed.map(workspace => ({
        name: workspace.name,
        path: workspace.path,
        members: workspace.members.map(member => ({
          name: member.name,
          path: member.path,
          projectId: member.projectId,
          status: member.projectId ? 'registered' as const : member.available ? 'available' as const : 'missing' as const,
        })),
      })),
      diagnostics,
      conflicts,
    }
    return {
      ...previewShape,
      revision: createHash('sha256').update(JSON.stringify(previewShape)).digest('hex'),
      canImport: parsed.length > 0 && conflicts.length === 0,
    }
  }

  /** Import each top-level .code-workspace file once after validating the exact preview revision. */
  async importVscodeDirectory(inputDirectory: string, groupName: string | undefined, expectedRevision: string): Promise<WorkspaceImportResult> {
    const preview = await this.previewVscodeDirectory(inputDirectory, groupName)
    if (preview.revision !== expectedRevision)
      throw new Error('Workspace import source changed after preview. Validate it again before importing.')
    if (!preview.canImport)
      throw new Error([...preview.conflicts, ...preview.diagnostics.map(item => item.message)].join('; ') || 'No valid VS Code workspaces could be imported')

    const group = await this.workspaces.createGroup(preview.groupName)
    const imported = []
    for (const workspace of preview.workspaces) {
      imported.push(await this.workspaces.importWorkspace(workspace.name, workspace.members.map(member => ({
        name: member.name,
        path: member.path,
        projectId: member.projectId,
        available: member.status !== 'missing',
      })), group.id))
    }

    return {
      format: 'vscode-workspace',
      sourceDirectory: preview.sourceDirectory,
      sourceRevision: preview.revision,
      group,
      workspaces: imported,
      diagnostics: preview.diagnostics,
      validation: this.validateImport(preview, group, imported),
    }
  }

  private async parseWorkspace(
    path: string,
    projects: Awaited<ReturnType<ProjectRegistry['list']>>,
    diagnostics: WorkspaceImportDiagnostic[],
  ): Promise<ParsedWorkspace | undefined> {
    const errors: ParseError[] = []
    const value = parseJsonc(await readFile(path, 'utf8'), errors, { allowTrailingComma: true }) as VsCodeWorkspaceFile | undefined
    if (errors.length || !value || typeof value !== 'object' || !Array.isArray(value.folders)) {
      diagnostics.push({
        path,
        message: errors.length
          ? errors.map(error => printParseErrorCode(error.error)).join(', ')
          : 'Workspace file must contain a folders array',
      })
      return undefined
    }

    const members: ImportedWorkspaceMemberInput[] = []
    for (const [index, rawFolder] of value.folders.entries()) {
      const folder = rawFolder as VsCodeWorkspaceFolder
      if (!folder || typeof folder !== 'object' || typeof folder.path !== 'string' || !folder.path.trim()) {
        diagnostics.push({
          path,
          message: typeof folder?.uri === 'string'
            ? `Folder ${index + 1} uses unsupported uri`
            : `Folder ${index + 1} requires path`,
        })
        continue
      }
      const unresolvedPath = resolve(dirname(path), folder.path)
      const memberPath = await realpath(unresolvedPath).catch(() => unresolvedPath)
      const available = await access(unresolvedPath).then(() => true, () => false)
      if (members.some(member => member.path === memberPath))
        continue
      const project = projects.find(item => item.path === memberPath)
      members.push({
        name: typeof folder.name === 'string' && folder.name.trim() ? folder.name.trim() : basename(memberPath),
        path: memberPath,
        projectId: project?.id,
        available,
      })
    }
    return { name: basename(path, '.code-workspace'), path, members }
  }

  private validateImport(preview: WorkspaceImportPreview, group: WorkspaceGroup, workspaces: WorkspaceRecord[]): WorkspaceImportValidation {
    const issues: string[] = []
    if (workspaces.length !== preview.workspaces.length)
      issues.push(`Expected ${preview.workspaces.length} workspaces but imported ${workspaces.length}`)
    for (const expected of preview.workspaces) {
      const actual = workspaces.find(workspace => workspace.name === expected.name)
      if (!actual) {
        issues.push(`Missing imported workspace: ${expected.name}`)
        continue
      }
      if (actual.groupId !== group.id)
        issues.push(`Workspace is not assigned to ${group.name}: ${expected.name}`)
      if (actual.members.length !== expected.members.length)
        issues.push(`Workspace member count differs: ${expected.name}`)
      for (const member of expected.members) {
        const actualMember = actual.members.find(candidate => candidate.label === member.name || candidate.discoveryHint === basename(member.path))
        if (!actualMember)
          issues.push(`Missing imported member in ${expected.name}: ${member.name}`)
        else if (member.projectId && actualMember.projectId !== member.projectId)
          issues.push(`Registered project binding differs in ${expected.name}: ${member.name}`)
        else if (!member.projectId && actualMember.path !== member.path)
          issues.push(`Local project path differs in ${expected.name}: ${member.name}`)
      }
    }
    const members = workspaces.flatMap(workspace => workspace.members)
    return {
      valid: issues.length === 0,
      issues,
      workspaceCount: workspaces.length,
      memberCount: members.length,
      resolvedMemberCount: members.filter(member => member.resolved).length,
      unresolvedMemberCount: members.filter(member => !member.resolved).length,
    }
  }
}
