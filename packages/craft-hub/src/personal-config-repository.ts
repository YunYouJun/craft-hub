import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** A selected Personal configuration checkout. */
export interface PersonalConfigRepositoryReadyStatus {
  repositoryPath: string
  state: 'ready'
}

/** Observable state for the one local Git checkout used by Personal configuration features. */
export type PersonalConfigRepositoryStatus = PersonalConfigRepositoryReadyStatus | { repositoryPath?: undefined, state: 'unconfigured' }

interface PersonalConfigRepositoryDocument {
  repositoryPath?: string
  schemaVersion: 1
}

/** Own selection and validation of the shared Personal configuration Git checkout. */
export class PersonalConfigRepository {
  private readonly configurationPath: string

  constructor(dataDir: string) {
    this.configurationPath = join(dataDir, 'personal-config-repository.json')
  }

  /** Select a local Git checkout without performing network or working-tree operations. */
  async configure(repositoryPath: string): Promise<PersonalConfigRepositoryReadyStatus> {
    if (!repositoryPath.trim())
      throw new Error('Personal configuration repository path is required')
    const root = await gitRoot(resolve(repositoryPath))
    await writeJsonAtomic(this.configurationPath, { schemaVersion: 1, repositoryPath: root })
    return { repositoryPath: root, state: 'ready' }
  }

  /** Return the selected checkout without inspecting or changing its working tree. */
  async status(): Promise<PersonalConfigRepositoryStatus> {
    try {
      const value = JSON.parse(await readFile(this.configurationPath, 'utf8')) as PersonalConfigRepositoryDocument
      if (value.schemaVersion !== 1 || (value.repositoryPath !== undefined && typeof value.repositoryPath !== 'string'))
        throw new Error('Unsupported Personal configuration repository schema')
      return value.repositoryPath
        ? { repositoryPath: value.repositoryPath, state: 'ready' }
        : { state: 'unconfigured' }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { state: 'unconfigured' }
      throw error
    }
  }
}

async function gitRoot(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
    return realpath(stdout.trim())
  }
  catch {
    throw new Error(`Not a Git repository: ${path}`)
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
