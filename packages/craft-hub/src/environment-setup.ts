import type { LocalEnvironmentSnapshot } from './local-environment'
import type { SetupProfile, SetupProfileSnapshot } from './setup-profile'
import { z } from 'zod'
import { SetupProfileError } from './setup-profile'
import { softwareMetadataSchema } from './software-catalog'

const text = z.object({ en: z.string().min(1).max(2048), zh: z.string().min(1).max(2048).optional() }).strict()
const id = z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/)
/** Display-only guidance supplied by a trusted host; there is deliberately no execution action. */
export const environmentSetupStepSchema = z.object({
  id,
  title: text,
  description: text,
  state: z.enum(['ready', 'action-required', 'blocked', 'unknown', 'not-required']),
  dependsOn: z.array(id).max(10).default([]),
  actions: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('link'), title: text, url: softwareMetadataSchema.shape.url }).strict(),
    z.object({ kind: z.literal('copy'), title: text, text: z.string().min(1).max(16000) }).strict(),
  ])).max(8).default([]),
}).strict()

/** One observed prerequisite and instructions a user can review in their terminal. */
export type EnvironmentSetupStep = z.infer<typeof environmentSetupStepSchema>
/** Current host facts and desired references, excluding credentials and source contents. */
export interface EnvironmentSetupContext { environment: LocalEnvironmentSnapshot, profile: SetupProfile | null }
/** Optional installation guidance owned by the trusted adapter that owns the tool. */
export interface EnvironmentSetupProvider { id: string, read: (context: EnvironmentSetupContext) => Promise<EnvironmentSetupStep[]> }
/** Read-only, rechecked setup stages. Readiness does not mean that software or configuration was restored. */
export interface EnvironmentSetupSnapshot {
  version: 1
  checkedAt: string
  profileRevision: string
  platform: string
  steps: EnvironmentSetupStep[]
  prerequisitesReady: boolean
}

const words = (en: string, zh: string): { en: string, zh: string } => ({ en, zh })

/** Provide native prerequisites before optional adapters can depend on them. */
export function macSetupSteps(environment: LocalEnvironmentSnapshot, profile: SetupProfile | null): EnvironmentSetupStep[] {
  if (environment.host.platform !== 'darwin') {
    return [{ id: 'platform', title: words('Target Mac', '目标 Mac'), description: words('Open Craft Hub on the Mac you want to restore. This guide currently supports macOS.', '请在要恢复的 Mac 上打开 Craft Hub；当前引导面向 macOS。'), state: 'unknown', dependsOn: [], actions: [] }]
  }
  const git = environment.tools.find(tool => tool.id === 'git')
  const brew = environment.tools.find(tool => tool.id === 'homebrew')
  const needsBrew = !profile || profile.software.some(item => ['brew-cask', 'brew-formula'].includes(item.installation.kind))
  const prefix = environment.host.arch === 'arm64' ? '/opt/homebrew/bin/brew' : environment.host.arch === 'x64' ? '/usr/local/bin/brew' : undefined
  const brewActions: EnvironmentSetupStep['actions'] = [{ kind: 'link', title: words('Homebrew installation instructions', 'Homebrew 官方安装说明'), url: 'https://docs.brew.sh/Installation' }]
  if (brew?.status === 'missing')
    brewActions.push({ kind: 'copy', title: words('Copy official installer command', '复制官方安装命令'), text: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' })
  if (prefix)
    brewActions.push({ kind: 'copy', title: words('Use Homebrew in this terminal', '在当前终端启用 Homebrew'), text: `eval "$(${prefix} shellenv)"` })
  return [
    {
      id: 'developer-tools',
      title: words('Git and Apple developer tools', 'Git 与 Apple 开发者工具'),
      description: words('If developer tools are missing, run the command in Terminal and finish the macOS installer. Return here and check again.', '缺少开发者工具时，在终端运行命令并完成 macOS 安装窗口，然后返回这里重新检查。'),
      state: git?.status === 'available' ? 'ready' : git?.status === 'missing' || git?.reason === 'developer-tools-unavailable' ? 'action-required' : 'unknown',
      dependsOn: [],
      actions: [{ kind: 'link', title: words('Apple installation instructions', 'Apple 官方安装说明'), url: 'https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/' }, ...(git?.status !== 'available' ? [{ kind: 'copy' as const, title: words('Open the system installer', '打开系统安装器'), text: '/usr/bin/xcode-select --install' }] : [])],
    },
    {
      id: 'homebrew',
      title: words('Homebrew', 'Homebrew'),
      description: words('Used to install selected Homebrew software. Follow the official installer and its Next steps to configure your terminal. A missing detection may mean a different installation location.', '用于安装方案中的 Homebrew 软件。完成官方安装器及其 Next steps 中的终端设置；未检测到也可能是安装位置不同。'),
      state: !needsBrew ? 'not-required' : brew?.status === 'available' ? 'ready' : brew?.status === 'missing' ? 'action-required' : 'unknown',
      dependsOn: ['developer-tools'],
      actions: brewActions,
    },
  ]
}

/** Compose fresh host observations with independent adapter guidance, without installing or connecting anything. */
export class EnvironmentSetupService {
  constructor(private readonly environment: () => Promise<LocalEnvironmentSnapshot>, private readonly profile: () => Promise<SetupProfileSnapshot>, private readonly providers: EnvironmentSetupProvider[] = [], private readonly local = true) {
    if (new Set(providers.map(provider => provider.id)).size !== providers.length || providers.some(provider => !id.safeParse(provider.id).success || typeof provider.read !== 'function'))
      throw new Error('Environment setup providers require unique identifiers and read methods')
  }

  /** Recheck every stage; clicks, copied commands and elapsed time never establish completion. */
  async snapshot(): Promise<EnvironmentSetupSnapshot> {
    if (!this.local)
      throw new SetupProfileError(403, 'Environment setup requires a local workbench')
    const [environment, saved] = await Promise.all([this.environment(), this.profile()])
    const steps = macSetupSteps(environment, saved.profile)
    if (environment.host.platform === 'darwin') {
      const reports = await Promise.all(this.providers.map(async (provider) => {
        try {
          const result = z.array(environmentSetupStepSchema).max(20).parse(await provider.read({ environment: structuredClone(environment), profile: structuredClone(saved.profile) }))
          if (result.some(step => !step.id.startsWith(`${provider.id}.`)) || new Set(result.map(step => step.id)).size !== result.length)
            throw new Error('Invalid setup stage identity')
          return result
        }
        catch {
          return [{ id: `${provider.id}.unavailable`, title: words('Setup guidance unavailable', '暂时无法读取安装引导'), description: words('Check the local management plugin and retry. Other prerequisite checks remain available.', '请检查本机管理插件后重试，其他前置检查仍可使用。'), state: 'unknown' as const, dependsOn: [], actions: [] }]
        }
      }))
      steps.push(...reports.flat())
      if (!this.providers.length)
        steps.push({ id: 'management-plugin', title: words('Connect a local management plugin', '连接本机管理插件'), description: words('Open the desktop app with its approved local management plugin, or enable a trusted host extension in Plugins, then check again.', '请使用带本机管理插件的桌面应用，或在插件管理中启用已批准的宿主扩展，再重新检查。'), state: 'action-required', dependsOn: [], actions: [] })
    }
    const states = new Map(steps.map(step => [step.id, step.state]))
    const resolved = steps.map(step => step.state === 'action-required' && step.dependsOn.some(dependency => !['ready', 'not-required'].includes(states.get(dependency) ?? 'unknown')) ? { ...step, state: 'blocked' as const } : step)
    return { version: 1, checkedAt: environment.checkedAt, platform: environment.host.platform, profileRevision: saved.revision, steps: resolved, prerequisitesReady: saved.profile !== null && resolved.every(step => ['ready', 'not-required'].includes(step.state)) }
  }
}
