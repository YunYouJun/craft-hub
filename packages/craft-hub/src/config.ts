import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface ProjectConfig {
  version: 1
  project?: { name?: string, icon?: string }
  defaults?: { agent?: string }
  capabilities?: { hidden?: string[] }
}

/** Load optional project-owned metadata without requiring configuration. */
export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig | undefined> {
  const path = resolve(projectPath, '.craft-hub', 'project.yaml')
  try {
    await access(path)
  }
  catch {
    return undefined
  }
  const config = parseYaml(await readFile(path, 'utf8')) as Omit<ProjectConfig, 'version'> & { version?: number }
  if (config.version !== undefined && config.version !== 1)
    throw new Error(`Unsupported Craft Hub config version: ${String(config.version)}`)
  return { ...config, version: 1 }
}
