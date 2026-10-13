import type { ConfigurationManagementPage, CraftHubPlugin, OperationSupport, SoftwareApplicationOpen, SoftwareCatalog, SoftwareInstallationPlan, SoftwareInstallationRun, SoftwareInstallationRuns } from 'craft-hub'
import type { WorkstationSupport } from './host-support'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { parseRepositoryContentValidation, SoftwareOperationError } from 'craft-hub'
import { configurationItems, skillsAudit } from './configuration-display'
import { unavailableSupport, workstationDoctor, WorkstationHostError, workstationSupport } from './host-support'
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
export function workstationTransport(command = process.env.CRAFT_HUB_WORKSTATION_COMMAND ?? 'workstation', args: string[] = [], apiCommand: 'configuration' | 'software-json' | 'host-json' = 'configuration'): WorkstationTransport {
  return async (request) => {
    const executable = resolveLocalExecutable(command)
    return new Promise((resolve, reject) => {
      const child = spawn(executable.command, [...args, apiCommand], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: executable.env })
      let output = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Workstation timed out. Refresh recovery history before retrying.'))
      }, apiCommand === 'host-json' ? 20000 : apiCommand === 'software-json' ? 10000 : 120000)
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
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          if (apiCommand === 'host-json' && !output.trim())
            throw new WorkstationHostError('unsupported')
          const envelope = JSON.parse(output)
          if (apiCommand === 'host-json' && envelope.ok !== true)
            throw new WorkstationHostError(['UNSUPPORTED_VERSION', 'UNSUPPORTED_OPERATION'].includes(envelope.code) ? 'unsupported' : 'unavailable')
          if (apiCommand === 'host-json' && code !== 0)
            throw new WorkstationHostError('unavailable')
          if (envelope.ok !== true && apiCommand === 'software-json')
            throw softwareError(envelope.code)
          if (envelope.ok !== true)
            throw new Error(typeof envelope.error === 'string' ? envelope.error : 'Workstation operation failed')
          if (envelope.result?.version !== 1)
            throw apiCommand === 'host-json' ? new WorkstationHostError('unsupported') : new Error('Unsupported workstation protocol')
          resolve(envelope.result)
        }
        catch (error) { reject(error instanceof SyntaxError ? apiCommand === 'host-json' ? new WorkstationHostError('invalid') : new Error('Invalid workstation response. Check the local CLI version.') : error) }
      })
      child.stdin.end(JSON.stringify({ ...request, version: 1 }))
    })
  }
}

/** Thin Host Plugin adapter: no file interpretation, merging, backups or Git implementation. */
export function createWorkstationPlugin(transport: WorkstationTransport = workstationTransport(), softwareTransport: WorkstationTransport = workstationTransport(undefined, [], 'software-json'), hostTransport: WorkstationTransport = workstationTransport(undefined, [], 'host-json')): CraftHubPlugin {
  // Coalesce concurrent reads only; every later refresh or operation checks the current CLI.
  let negotiation: Promise<WorkstationSupport> | undefined
  function negotiate(): Promise<WorkstationSupport> {
    negotiation ??= hostTransport({ operation: 'capabilities' }).then(workstationSupport).catch(unavailableSupport).finally(() => {
      negotiation = undefined
    })
    return negotiation
  }
  const allowed = (support: OperationSupport, operation: string): boolean => support.state === 'available' && support.operations[operation]?.supported === true
  async function configurationOperation(operation: string): Promise<void> {
    if (!allowed((await negotiate()).configuration, operation))
      throw new Error('This configuration operation is unavailable on this platform or CLI version. Refresh capabilities or update Workstation.')
  }
  async function softwareOperation(operation: string): Promise<void> {
    if (!allowed((await negotiate()).software, operation))
      throw new SoftwareOperationError(403, 'This software operation is unavailable on this platform or CLI version. Refresh capabilities or update Workstation.')
  }
  async function page(extra: Partial<ConfigurationManagementPage> = {}, projectPath?: string): Promise<ConfigurationManagementPage> {
    const support = (await negotiate()).configuration
    const readable = (operation: string): boolean => support.state !== 'available' || allowed(support, operation)
    const [inventory, history, git] = await Promise.all([
      readable('inspect') ? transport({ operation: 'inspect', projectPath }) : Promise.resolve<Record<string, unknown>>({ items: [] }),
      readable('history') ? transport({ operation: 'history' }) : Promise.resolve<Record<string, unknown>>({ plans: [] }),
      readable('git-status') ? transport({ operation: 'git-status' }) : Promise.resolve<Record<string, unknown>>({ repositories: [] }),
    ])
    return {
      configuration: true,
      operationSupport: support,
      items: configurationItems(inventory.items),
      skillsAudit: skillsAudit(inventory.skillsAudit),
      managementTools: [
        { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation/blob/main/docs/en/guide/codex-skills.md' },
        { id: 'apm', title: 'APM', url: 'https://microsoft.github.io/apm/' },
        { id: 'skills-cli', title: 'Skills CLI', url: 'https://skills.sh/docs' },
        { id: 'native-plugin', title: 'Codex Plugins', url: 'https://developers.openai.com/codex/plugins/' },
        { id: 'project', title: 'Craft Hub project configuration', url: 'https://github.com/YunYouJun/craft-hub/blob/main/docs/guide/configuration.md' },
        { id: 'magpie', title: 'Magpie', url: 'https://usemagpie.ai/', software: { sourceId: 'workstation', softwareId: 'magpie' } },
      ],
      history: history.plans as ConfigurationManagementPage['history'],
      repositories: git.repositories as ConfigurationManagementPage['repositories'],
      ...extra,
    }
  }
  return {
    id: '@craft-hub/craft-hub-plugin-workstation',
    name: '开发环境',
    version: '0.1.0',
    repositoryValidationProviders: [{
      id: 'workstation-projects',
      format: 'projects',
      files: ['projects.yaml', 'projects.yml', 'projects.example.yaml'],
      validate: async (content) => {
        if (!(await negotiate()).repositoryValidation) {
          return { status: 'unsupported', issues: [{ code: 'unsupported-version', path: '/', message: 'Update the local Workstation CLI to enable project manifest validation.' }] }
        }
        const result = await hostTransport({ operation: 'validate-projects', content })
        if (result.version !== 1 || typeof result.valid !== 'boolean')
          throw new WorkstationHostError('invalid')
        return parseRepositoryContentValidation({ status: result.valid ? 'valid' : 'invalid', issues: result.issues })
      },
    }],
    diagnosticProviders: [{
      id: 'workstation',
      title: 'Workstation',
      localOnly: true,
      read: async () => {
        const support = await negotiate()
        if (support.configuration.state !== 'available' || !support.doctor) {
          return { version: 1, checkedAt: new Date().toISOString(), checks: [{ code: support.configuration.state === 'unsupported' ? 'capabilities-unsupported' : 'capabilities-unavailable', severity: support.configuration.state === 'unsupported' ? 'warning' : 'error', message: support.configuration.message ?? 'Workstation doctor is unavailable on this platform or CLI version.', target: { type: 'integration', integrationId: 'workstation' } }] }
        }
        return workstationDoctor(await hostTransport({ operation: 'doctor' }), support)
      },
    }],
    softwareCatalogProviders: [{
      id: 'workstation',
      title: 'Workstation',
      url: 'https://github.com/YunYouJun/workstation',
      read: async () => {
        const support = (await negotiate()).software
        if (support.state === 'available' && !allowed(support, 'catalog'))
          throw new SoftwareOperationError(403, 'This software operation is unavailable on this platform or CLI version. Refresh capabilities or update Workstation.')
        const catalog = await softwareTransport({ operation: 'catalog' }) as unknown as SoftwareCatalog
        return { ...catalog, operationSupport: support, items: catalog.items.map(item => ({ ...item, canInstall: item.canInstall === true && allowed(support, 'preview') && allowed(support, 'install'), canOpen: item.canOpen === true && allowed(support, 'open') })) }
      },
      management: {
        preview: async (softwareIds) => {
          await softwareOperation('preview')
          return await softwareTransport({ operation: 'preview', softwareIds }) as unknown as SoftwareInstallationPlan
        },
        install: async (planId, confirmed) => {
          if (confirmed !== true)
            throw new SoftwareOperationError(409, 'Review and confirm the software installation plan')
          await softwareOperation('install')
          return await softwareTransport({ operation: 'install', planId, confirmed }) as unknown as SoftwareInstallationRun
        },
        runs: async () => {
          await softwareOperation('runs')
          return await softwareTransport({ operation: 'runs' }) as unknown as SoftwareInstallationRuns
        },
        cancel: async (runId) => {
          await softwareOperation('cancel')
          return await softwareTransport({ operation: 'cancel', runId }) as unknown as SoftwareInstallationRun
        },
        open: async (softwareId) => {
          await softwareOperation('open')
          return await softwareTransport({ operation: 'open', softwareId }) as unknown as SoftwareApplicationOpen
        },
      },
    }],
    integrationProviders: [{
      id: 'workstation',
      apiVersion: '1.0.0',
      connectionStatus: async (context) => {
        if (context.hostEnvironment === 'hosted')
          return { connected: false, message: 'Workstation requires a local workbench.' }
        const support = (await negotiate()).configuration
        return { connected: support.state === 'available', ...(support.message ? { message: support.message } : {}), ...(support.cliVersion ? { accountLabel: `Workstation ${support.cliVersion} · ${support.platform}` } : {}) }
      },
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
            await configurationOperation('preview')
            const preview = await transport({ operation: 'preview', decisions: input.decisions })
            return page({ preview: preview as unknown as ConfigurationManagementPage['preview'] }, context.projectPath)
          }
          if (!['apply', 'restore'].includes(String(input.operation)))
            throw new Error('Unsupported configuration operation')
          await configurationOperation(String(input.operation))
          const result = await transport({ operation: input.operation, planId: input.planId })
          return page({ message: String(result.error ?? result.state) }, context.projectPath)
        },
        execute: async (context, input) => {
          if (!context.confirmed || input.operation !== 'git-action' || !['fetch', 'commit', 'publish'].includes(String(input.action)))
            throw new Error('Review and confirm the Git action')
          await configurationOperation(`git-${String(input.action)}`)
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
          'Skills audit is unavailable in this Workstation version. Update the local CLI to enable diagnostics.': '当前 Workstation 版本尚不支持 Skills 审计，请更新本机 CLI 后查看诊断。',
          'Workstation could not complete Skills audit. Refresh and check the local CLI.': 'Workstation 未能完成 Skills 审计，请刷新并检查本机 CLI。',
          'Workstation Skills audit response is invalid. Update the local CLI and refresh.': 'Workstation 的 Skills 审计响应无效，请更新本机 CLI 后刷新。',
          'Local Skill; manager unknown': '本地 Skill，管理器未知',
          'Project repository': '项目仓库',
          'Codex native plugin or bundled Skill': 'Codex 原生插件或内置 Skill',
          'Codex bundled Skills': 'Codex 内置 Skills',
          'Codex plugin configuration': 'Codex 插件配置',
          'APM deployment lock': 'APM 部署锁文件',
          'skills.sh registry lock': 'skills.sh 安装来源锁文件',
          'Workstation provenance lock': 'Workstation 来源锁文件',
          'Workstation private manifest': 'Workstation 私有配置声明',
          'Workstation public configuration': 'Workstation 公开配置',
          'External symbolic link': '外部符号链接',
          'Use the original skill/plugin installer': '请通过原 Skill 或插件安装器管理。',
          'Manage through the project configuration': '请通过项目配置管理。',
          'Use the original Skill installer; global configuration synchronization does not replace this deployment.': '请通过原 Skill 安装器管理，全局配置同步不会接管这项部署。',
          'Manage this Skill in the project repository.': '请在项目仓库中管理这项 Skill。',
          'Use the original Skill manager; audit inventory does not authorize writes.': '请通过原 Skill 管理器维护，审计盘点不授予写入权限。',
          'Skill ownership changed after application. Review the original installer before recovery.': '应用后 Skill 的管理归属发生变化，请检查原安装器后再恢复。',
          'Skill ownership is unavailable. Check installer locks before recovery.': '无法确认 Skill 的管理归属，请检查安装器锁文件后再恢复。',
          'This Workstation version does not support capability negotiation. Update the local CLI to enable managed operations.': '当前 Workstation 不支持能力协商，请更新本机 CLI 后使用管理操作。',
          'Workstation capability negotiation is unavailable. Configure the local CLI and refresh.': '无法与 Workstation 协商能力，请检查本机 CLI 后刷新。',
          'Workstation capability response is invalid. Update the local CLI and refresh.': 'Workstation 能力响应无效，请更新本机 CLI 后刷新。',
          'This configuration operation is unavailable on this platform or CLI version. Refresh capabilities or update Workstation.': '当前平台或 CLI 版本不支持此配置操作，请刷新能力或更新 Workstation。',
          'This software operation is unavailable on this platform or CLI version. Refresh capabilities or update Workstation.': '当前平台或 CLI 版本不支持此软件操作，请刷新能力或更新 Workstation。',
          'Workstation requires a local workbench.': 'Workstation 需要在本地工作台使用。',
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
