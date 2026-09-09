import type { ConfigurationManagementPage, CraftHubPlugin } from 'craft-hub'
import { spawn } from 'node:child_process'
import process from 'node:process'

export type WorkstationTransport = (request: Record<string, unknown>) => Promise<Record<string, unknown>>

/**
 Invoke only the workstation JSON API
paths and invocation are configured on the trusted host.
 */
export function workstationTransport(command = process.env.CRAFT_HUB_WORKSTATION_COMMAND ?? 'workstation', args: string[] = []): WorkstationTransport {
  return request => new Promise((resolve, reject) => {
    const child = spawn(command, [...args, 'configuration'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Workstation timed out. Refresh recovery history before retrying.'))
    }, 120000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (output.length > 8 * 1024 * 1024) {
        child.kill()
        reject(new Error('Workstation response exceeded its limit.'))
      }
    })
    // Never forward process stderr: external tool diagnostics may contain local secrets.
    child.stderr.resume()
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Workstation is unavailable. Configure the versioned local CLI on this host.'))
    })
    child.stdin.on('error', () => {})
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const envelope = JSON.parse(output)
        if (envelope.ok !== true)
          throw new Error(typeof envelope.error === 'string' ? envelope.error : 'Workstation operation failed')
        if (envelope.result?.version !== 1)
          throw new Error('Unsupported workstation protocol')
        resolve(envelope.result)
      }
      catch (error) { reject(error instanceof SyntaxError ? new Error('Invalid workstation response. Check the local CLI version.') : error) }
    })
    child.stdin.end(JSON.stringify({ ...request, version: 1 }))
  })
}

/** Thin Host Plugin adapter: no file interpretation, merging, backups or Git implementation. */
export function createWorkstationPlugin(transport: WorkstationTransport = workstationTransport()): CraftHubPlugin {
  async function page(extra: Partial<ConfigurationManagementPage> = {}, projectPath?: string): Promise<ConfigurationManagementPage> {
    const [inventory, history, git] = await Promise.all([
      transport({ operation: 'inspect', projectPath }),
      transport({ operation: 'history' }),
      transport({ operation: 'git-status' }),
    ])
    return { configuration: true, items: inventory.items as ConfigurationManagementPage['items'], history: history.plans as ConfigurationManagementPage['history'], repositories: git.repositories as ConfigurationManagementPage['repositories'], ...extra }
  }
  return {
    id: '@craft-hub/craft-hub-plugin-workstation',
    name: '开发环境',
    version: '0.1.0',
    integrationProviders: [{
      id: 'workstation',
      apiVersion: '1.0.0',
      connectionStatus: async () => ({ connected: true }),
      configuration: {
        read: async (context, input) => {
          if (input.operation && input.operation !== 'inspect')
            throw new Error('Unsupported read operation')
          return page({}, context.projectPath)
        },
        update: async (context, input) => {
          if (!context.confirmed)
            throw new Error('Review and confirm the configuration action')
          if (input.operation === 'preview') {
            const preview = await transport({ operation: 'preview', decisions: input.decisions })
            return page({ preview: preview as unknown as ConfigurationManagementPage['preview'] }, context.projectPath)
          }
          if (!['apply', 'restore'].includes(String(input.operation)))
            throw new Error('Unsupported configuration operation')
          const result = await transport({ operation: input.operation, planId: input.planId })
          return page({ message: String(result.error ?? result.state) }, context.projectPath)
        },
        execute: async (context, input) => {
          if (!context.confirmed || input.operation !== 'git-action' || !['fetch', 'commit', 'publish'].includes(String(input.action)))
            throw new Error('Review and confirm the Git action')
          await transport({ operation: 'git-action', action: input.action, repository: input.repository, revision: input.revision, paths: input.paths, message: input.message })
          return page({ message: `Git ${String(input.action)} completed` }, context.projectPath)
        },
      },
    }],
    integrations: [{
      id: 'workstation',
      provider: { id: 'workstation', requires: '^1.0.0' },
      actions: [
        { id: 'inspect', title: 'Inspect configuration', operation: 'configuration.read', effect: 'local-read', confirmation: 'never' },
        { id: 'update', title: 'Review configuration changes', operation: 'configuration.update', effect: 'local-write', confirmation: 'always' },
        { id: 'git', title: 'Synchronize repository', operation: 'configuration.execute', effect: 'remote-write', confirmation: 'always' },
      ],
      views: [{ id: 'environment', title: '开发环境', icon: 'builtin:terminal', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'configuration', type: 'configuration-manager', actionId: 'inspect' }] }],
    }],
  }
}

export default createWorkstationPlugin()
