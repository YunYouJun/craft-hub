import type { ConfigurationManagementPage, CraftHubPlugin, SoftwareApplicationOpen, SoftwareCatalog, SoftwareInstallationPlan, SoftwareInstallationRun, SoftwareInstallationRuns } from 'craft-hub'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { SoftwareOperationError } from 'craft-hub'
import { resolveLocalExecutable } from './local-executable'

export type WorkstationTransport = (request: Record<string, unknown>) => Promise<Record<string, unknown>>

function softwareError(code: unknown): SoftwareOperationError {
  switch (code) {
    case 'PLAN_STALE':
    case 'PLAN_EXPIRED': return new SoftwareOperationError(409, 'Software plan has changed or expired. Review a new plan.')
    case 'INSTALL_BUSY': return new SoftwareOperationError(409, 'A software installation is already active. Refresh its history.')
    case 'NOT_FOUND': return new SoftwareOperationError(404, 'Software or installation history is unavailable. Refresh the catalog.')
    case 'CONFIRMATION_REQUIRED': return new SoftwareOperationError(409, 'Review and confirm the software installation plan')
    case 'INVALID_REQUEST': return new SoftwareOperationError(400, 'Invalid software request')
    default: return new SoftwareOperationError(503, 'Software operation is unavailable. Check the local Workstation CLI and refresh its history.')
  }
}

/**
 Invoke only the workstation JSON API
paths and invocation are configured on the trusted host.
 */
export function workstationTransport(command = process.env.CRAFT_HUB_WORKSTATION_COMMAND ?? 'workstation', args: string[] = [], apiCommand: 'configuration' | 'software-json' = 'configuration'): WorkstationTransport {
  return async (request) => {
    const executable = resolveLocalExecutable(command)
    return new Promise((resolve, reject) => {
      const child = spawn(executable.command, [...args, apiCommand], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: executable.env })
      let output = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Workstation timed out. Refresh recovery history before retrying.'))
      }, apiCommand === 'software-json' ? 10000 : 120000)
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
          if (envelope.ok !== true && apiCommand === 'software-json')
            throw softwareError(envelope.code)
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
}

/** Thin Host Plugin adapter: no file interpretation, merging, backups or Git implementation. */
export function createWorkstationPlugin(transport: WorkstationTransport = workstationTransport(), softwareTransport: WorkstationTransport = workstationTransport(undefined, [], 'software-json')): CraftHubPlugin {
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
    softwareCatalogProviders: [{
      id: 'workstation',
      title: 'Workstation',
      url: 'https://github.com/YunYouJun/workstation',
      read: async () => await softwareTransport({ operation: 'catalog' }) as unknown as SoftwareCatalog,
      management: {
        preview: async softwareIds => await softwareTransport({ operation: 'preview', softwareIds }) as unknown as SoftwareInstallationPlan,
        install: async (planId, confirmed) => {
          if (confirmed !== true)
            throw new SoftwareOperationError(409, 'Review and confirm the software installation plan')
          return await softwareTransport({ operation: 'install', planId, confirmed }) as unknown as SoftwareInstallationRun
        },
        runs: async () => await softwareTransport({ operation: 'runs' }) as unknown as SoftwareInstallationRuns,
        cancel: async runId => await softwareTransport({ operation: 'cancel', runId }) as unknown as SoftwareInstallationRun,
        open: async softwareId => await softwareTransport({ operation: 'open', softwareId }) as unknown as SoftwareApplicationOpen,
      },
    }],
    integrationProviders: [{
      id: 'workstation',
      apiVersion: '1.0.0',
      connectionStatus: async () => ({ connected: true }),
      configurationManagement: {
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
      translations: {
        'zh-CN': {
          'Inspect configuration': '配置同步',
          'Review configuration changes': '审阅配置修改',
          'Synchronize repository': '同步仓库',
          'Workstation is unavailable. Configure the versioned local CLI on this host.': '无法连接 Workstation。请在本机配置支持当前版本接口的本地 CLI。',
          'Workstation timed out. Refresh recovery history before retrying.': 'Workstation 请求超时。请刷新恢复记录后重试。',
          'Workstation response exceeded its limit.': 'Workstation 返回的数据超出大小限制。',
          'Unsupported workstation protocol': '不支持此 Workstation 接口版本，请更新本地 CLI。',
          'Workstation operation failed': 'Workstation 操作失败。',
          'Invalid workstation response. Check the local CLI version.': 'Workstation 返回的数据无效，请检查本地 CLI 版本。',
          'Unsupported read operation': '不支持此读取操作。',
          'Review and confirm the configuration action': '请先审阅并确认配置操作。',
          'Unsupported configuration operation': '不支持此配置操作。',
          'Review and confirm the Git action': '请先审阅并确认 Git 操作。',
        },
        'en': { 环境配置: 'Environment configuration' },
      },
      id: 'workstation',
      provider: { id: 'workstation', requires: '^1.0.0' },
      actions: [
        { id: 'inspect', title: 'Inspect configuration', operation: 'configuration.read', effect: 'local-read', confirmation: 'never' },
        { id: 'update', title: 'Review configuration changes', operation: 'configuration.update', effect: 'local-write', confirmation: 'always' },
        { id: 'git', title: 'Synchronize repository', operation: 'configuration.execute', effect: 'remote-write', confirmation: 'always' },
      ],
      views: [{ id: 'environment', title: '环境配置', icon: 'builtin:terminal', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'configuration', type: 'configuration-manager', actionId: 'inspect' }] }],
    }],
  }
}

export default createWorkstationPlugin()
