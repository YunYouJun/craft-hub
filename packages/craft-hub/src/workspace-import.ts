import type { ParseError } from 'jsonc-parser'
import type { ProjectRegistry } from './projects'
import type { WorkspaceImportDiagnostic, WorkspaceImportResult } from './types'
import type { ImportedWorkspaceMemberInput, WorkspaceService } from './workspaces'
import { readdir, readFile, realpath } from 'node:fs/promises'
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
  members: ImportedWorkspaceMemberInput[]
}

/** Convert external workspace documents into user-owned Craft Hub workspaces. */
export class WorkspaceImportService {
  constructor(
    private readonly projects: ProjectRegistry,
    private readonly workspaces: WorkspaceService,
  ) {}

  /** Import each top-level .code-workspace file once; the source is not synchronized afterward. */
  async importVscodeDirectory(inputDirectory: string, groupName?: string): Promise<WorkspaceImportResult> {
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
    if (!names.length)
      throw new Error('No .code-workspace files were found in the selected directory or its workspaces subdirectory')

    const diagnostics: WorkspaceImportDiagnostic[] = []
    const projects = await this.projects.list()
    const parsed: ParsedWorkspace[] = []
    for (const name of names) {
      const path = join(sourceDirectory, name)
      const workspace = await this.parseWorkspace(path, projects, diagnostics)
      if (workspace)
        parsed.push(workspace)
    }
    if (!parsed.length)
      throw new Error('No valid VS Code workspaces could be imported')

    const defaultGroupName = basename(sourceDirectory) === 'workspaces'
      ? basename(dirname(sourceDirectory))
      : basename(sourceDirectory)
    const group = await this.workspaces.createGroup(groupName?.trim() || defaultGroupName)
    const imported = []
    for (const workspace of parsed)
      imported.push(await this.workspaces.importWorkspace(workspace.name, workspace.members, group.id))

    return { format: 'vscode-workspace', sourceDirectory, group, workspaces: imported, diagnostics }
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
      if (members.some(member => member.path === memberPath))
        continue
      const project = projects.find(item => item.path === memberPath)
      members.push({
        name: typeof folder.name === 'string' && folder.name.trim() ? folder.name.trim() : basename(memberPath),
        path: memberPath,
        projectId: project?.id,
      })
    }
    return { name: basename(path, '.code-workspace'), members }
  }
}
