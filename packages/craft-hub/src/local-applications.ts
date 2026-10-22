import { spawn } from 'node:child_process'
import process from 'node:process'

/** Destination selected by one built-in application shortcut. */
export interface LocalApplicationOpenResult {
  destination: 'application' | 'website'
}

/** Launch one host-owned command and resolve only after the opener exits successfully. */
export type LocalApplicationLauncher = (command: string, args: string[]) => Promise<void>

interface MicrosoftTodoOpenOptions {
  platform?: NodeJS.Platform
  launch?: LocalApplicationLauncher
}

const microsoftTodoWebsite = 'https://to-do.office.com/tasks/'

const launchProcess: LocalApplicationLauncher = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { shell: false, stdio: 'ignore', windowsHide: true })
  child.once('error', reject)
  child.once('close', (code) => {
    if (code === 0)
      resolve()
    else
      reject(new Error('The system could not open the application'))
  })
})

/** Open Microsoft To Do on this device, falling back to its fixed official website. */
export async function openMicrosoftTodo(options: MicrosoftTodoOpenOptions = {}): Promise<LocalApplicationOpenResult> {
  const platform = options.platform ?? process.platform
  const launch = options.launch ?? launchProcess
  if (platform === 'darwin') {
    try {
      await launch('/usr/bin/open', ['-b', 'com.microsoft.to-do-mac'])
      return { destination: 'application' }
    }
    catch {
      // Launch Services reports missing applications and failed launches through a nonzero exit.
    }
  }
  if (platform === 'darwin')
    await launch('/usr/bin/open', [microsoftTodoWebsite])
  else if (platform === 'win32')
    await launch('cmd.exe', ['/d', '/s', '/c', 'start', '', microsoftTodoWebsite])
  else
    await launch('xdg-open', [microsoftTodoWebsite])
  return { destination: 'website' }
}
