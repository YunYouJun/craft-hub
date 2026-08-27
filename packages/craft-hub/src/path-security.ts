import { realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'

/** Resolve and validate that a command working directory stays inside its trusted project. */
export async function assertCommandWorkingDirectory(projectPath: string, cwd: string): Promise<void> {
  const [projectRoot, commandDirectory] = await Promise.all([realpath(projectPath), realpath(cwd)])
  const relativePath = relative(projectRoot, commandDirectory)
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error('Command working directory must stay inside its project')
}
