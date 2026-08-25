import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/** Return the operating-system data directory used by Craft Hub. */
export function getCraftHubDataDir(env: NodeJS.ProcessEnv = process.env, applicationName = 'Craft Hub'): string {
  if (env.CRAFT_HUB_DATA_DIR)
    return env.CRAFT_HUB_DATA_DIR

  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', applicationName)

  if (process.platform === 'win32')
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), applicationName)

  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), applicationName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, ''))
}
