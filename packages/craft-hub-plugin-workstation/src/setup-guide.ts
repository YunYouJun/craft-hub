import type { EnvironmentSetupProvider, EnvironmentSetupStep } from 'craft-hub'
import type { WorkstationSupport } from './host-support'
import type { WorkstationTransport } from './index'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const words = (en: string, zh: string): { en: string, zh: string } => ({ en, zh })
const quote = (value: string): string => `'${value.replace(/'/g, '\'\\\'\'')}'`
const documentation = 'https://github.com/YunYouJun/workstation/blob/main/docs/en/guide/bootstrap.md'
const link = { kind: 'link' as const, title: words('Workstation setup instructions', 'Workstation 安装与连接说明'), url: documentation }

/** Host-only inputs for generating copyable instructions; none can be supplied by a browser request. */
export interface WorkstationSetupOptions {
  homeDirectory?: string
  command?: string
  sourceDirectory?: string
  sourceDataDirectory?: string
  managed?: boolean
  invocation?: { command: string, args: string[], environment: Record<string, string> }
  sourceExists?: (path: string) => boolean
}

/** Workstation owns its installation and source connection instructions; reads never launch an installer. */
export function workstationSetupProvider(negotiate: () => Promise<WorkstationSupport>, transport: WorkstationTransport, options: WorkstationSetupOptions = {}): EnvironmentSetupProvider {
  return {
    id: 'workstation',
    read: async ({ environment, profile }) => {
      const support = await negotiate()
      const node = environment.tools.find(tool => tool.id === 'node')
      const npm = environment.tools.find(tool => tool.id === 'npm')
      const brew = environment.tools.find(tool => tool.id === 'homebrew')
      const nodeVersion = node?.version?.match(/^(\d+)\.(\d+)\./)
      const nodeReady = node?.status === 'available' && !!nodeVersion && (Number(nodeVersion[1]) > 22 || (Number(nodeVersion[1]) === 22 && Number(nodeVersion[2]) >= 18)) && npm?.status === 'available' && Number(npm.version?.split('.')[0]) >= 7
      const wanted = profile?.configurations.filter(item => item.integrationId === 'workstation') ?? []
      const needed = !profile || wanted.length > 0 || profile.software.some(item => item.sourceId === 'workstation')
      const supported = (domain: WorkstationSupport['configuration'], operation: string): boolean => domain.state === 'available' && domain.operations[operation]?.supported === true
      const cliReady = supported(support.configuration, 'inspect') && supported(support.configuration, 'preview') && supported(support.configuration, 'apply')
        && supported(support.software, 'catalog') && supported(support.software, 'preview') && supported(support.software, 'install')
      const home = options.homeDirectory ?? homedir()
      const directory = join(home, 'repos', 'github.com', 'YunYouJun', 'workstation')
      const cli = join(directory, 'packages', 'cli', 'dist', 'cli.js')
      const launcher = join(home, '.local', 'bin', 'workstation')
      const activeCommand = options.command ?? process.env.CRAFT_HUB_WORKSTATION_COMMAND ?? environment.tools.find(tool => tool.id === 'workstation')?.executablePath ?? launcher
      const invocation = options.invocation
        ? ['env', ...Object.entries(options.invocation.environment).map(([key, value]) => quote(`${key}=${value}`)), quote(options.invocation.command), ...options.invocation.args.map(quote)].join(' ')
        : quote(activeCommand)
      const sourceExists = (options.sourceExists ?? existsSync)(join(directory, '.git'))
      const build = [
        ...(brew?.status === 'available' && brew.executablePath ? [`eval "$(${quote(brew.executablePath)} shellenv)"`] : []),
        ...(!sourceExists ? [`mkdir -p ${quote(join(home, 'repos', 'github.com', 'YunYouJun'))}`, `git clone -- https://github.com/YunYouJun/workstation.git ${quote(directory)}`] : []),
        `npm exec --yes --package=pnpm@11.21.0 -- pnpm --dir ${quote(directory)} --filter @yunyoujun/workstation... install --frozen-lockfile`,
        `npm exec --yes --package=pnpm@11.21.0 -- pnpm --dir ${quote(directory)} --filter @yunyoujun/workstation run build`,
      ].join(' &&\n')
      const register = [
        `mkdir -p ${quote(join(home, '.local', 'bin'))}`,
        `chmod u+x ${quote(cli)}`,
        `ln -s ${quote(cli)} ${quote(launcher)}`,
      ].join(' &&\n')
      const nodeActions: EnvironmentSetupStep['actions'] = [{ kind: 'link', title: words('Node.js official downloads', 'Node.js 官方下载'), url: 'https://nodejs.org/en/download' }]
      if (!nodeReady && !cliReady && brew?.status === 'available' && brew.executablePath)
        nodeActions.push({ kind: 'copy', title: words('Install Node.js with Homebrew', '通过 Homebrew 安装 Node.js'), text: `${quote(brew.executablePath)} install node` })
      const steps: EnvironmentSetupStep[] = [
        {
          id: 'workstation.node',
          title: words('Node.js for Workstation', 'Workstation 所需的 Node.js'),
          description: options.managed
            ? words('Craft Hub runs its prebuilt backend with the desktop runtime. You can install a project Node.js separately when needed.', 'Craft Hub 使用桌面运行时启动预构建后端。项目所需的 Node.js 可以之后按需安装。')
            : words('A source build needs Node.js 22.18 or newer and npm. Craft Hub’s bundled runtime does not install a terminal Node.js. Follow Homebrew’s terminal setup before using npm.', '源码构建需要 Node.js 22.18 或更高版本及 npm。Craft Hub 自带的运行时不等于终端已安装 Node.js；使用 npm 前请完成 Homebrew 的终端设置。'),
          state: !needed || options.managed || cliReady ? 'not-required' : nodeReady ? 'ready' : !node || !npm || node.status === 'error' || npm.status === 'error' ? 'unknown' : 'action-required',
          dependsOn: !options.managed && !nodeReady && brew?.status !== 'available' && (!profile || profile.software.some(item => ['brew-cask', 'brew-formula'].includes(item.installation.kind))) ? ['homebrew'] : [],
          actions: options.managed ? [] : nodeActions,
        },
        {
          id: 'workstation.cli',
          title: options.managed ? words('Workstation environment engine', 'Workstation 环境引擎') : words('Build and connect Workstation', '构建并连接 Workstation'),
          description: options.managed
            ? words('Included with Craft Hub and updated with the app. No source checkout, package-manager install or build is needed for this engine. If capability checks fail, update Craft Hub and recheck.', '已随 Craft Hub 提供并随应用更新。使用环境引擎无需拉取源码、安装构建依赖或编译。若能力检查失败，请更新 Craft Hub 后重新检查。')
            : words('Review the public source, install its dependencies and build the CLI, then register its launcher. Existing source directories are reused without pulling; an existing launcher is never overwritten. If another CLI takes precedence, inspect its path in Machine checks and update that copy. Check again after each stage.', '审阅公开源码后安装依赖、构建 CLI，再登记启动入口。已有源码目录会复用且不自动拉取；已有启动入口不会被覆盖。若其他 CLI 优先，请在本机检测中核对路径并更新该副本。每阶段完成后重新检查。'),
          state: !needed ? 'not-required' : cliReady ? 'ready' : 'action-required',
          dependsOn: options.managed ? [] : ['developer-tools', 'workstation.node'],
          actions: options.managed ? [{ kind: 'link', title: words('Craft Hub releases', 'Craft Hub 更新与下载'), url: 'https://github.com/YunYouJun/craft-hub/releases' }] : cliReady ? [link] : [link, { kind: 'copy', title: words('Get source and build', '获取源码并构建'), text: build }, { kind: 'copy', title: words('Register the CLI launcher', '登记 CLI 启动入口'), text: register }],
        },
      ]
      let sourceState: EnvironmentSetupStep['state'] = wanted.length ? 'action-required' : 'not-required'
      if (wanted.length && cliReady) {
        try {
          const result = await transport({ operation: 'inspect' })
          const items = result.items
          if (!Array.isArray(items))
            throw new Error('Invalid configuration inventory')
          sourceState = wanted.every(reference => items.some((item: Record<string, unknown>) => item?.id === reference.itemId && item.origin === reference.origin && item.owner === 'user' && item.scope !== 'project' && typeof item.sourcePath === 'string' && !!item.sourcePath && typeof item.source === 'string' && item.source !== '(absent)' && !['error', 'unmanaged', 'read-only'].includes(String(item.status)))) ? 'ready' : 'action-required'
        }
        catch { sourceState = 'unknown' }
      }
      const privateSource = wanted.some(item => item.origin === 'private')
      const publicSource = wanted.some(item => item.origin === 'public')
      const sourceDirectory = options.sourceDirectory ?? directory
      const sourceActions: EnvironmentSetupStep['actions'] = [link]
      if (options.managed && publicSource)
        sourceActions.push({ kind: 'copy', title: words('Connect public configuration files', '连接公开配置文件'), text: (options.sourceExists ?? existsSync)(join(sourceDirectory, '.git')) ? `git -C ${quote(sourceDirectory)} status --short --branch` : `git clone -- https://github.com/YunYouJun/workstation.git ${quote(sourceDirectory)}` })
      if (privateSource)
        sourceActions.push({ kind: 'copy', title: words('Connect a private configuration repository', '连接私有配置仓库'), text: `${invocation} private connect --yes` })
      sourceActions.push({ kind: 'copy', title: words('Inspect configuration sources', '检查配置源'), text: `${invocation} dotfiles doctor` })
      steps.push({
        id: 'workstation.sources',
        title: words('Connect the configuration sources', '连接方案中的配置源'),
        description: options.managed && publicSource
          ? words('Connect the public configuration repository using the form below. No build is needed. Also connect a private source when selected entries require it. Review and apply configuration separately.', '在下方输入公开配置仓库地址并连接，无需构建。方案包含私有配置时也需连接私有来源；配置仍需单独审阅后应用。')
          : privateSource
            ? words('Enter the private repository URL below and complete authentication when requested. Workstation validates and remembers its configuration manifest. Connecting prepares the source; applying files remains a separate review.', '在下方输入包含所选配置的私有仓库地址，并按提示完成认证。Workstation 会验证并记住配置清单。连接只准备来源，配置文件仍需单独审阅后应用。')
            : words('Public configuration comes with the source checkout above. If selected entries are missing, inspect the CLI’s source with dotfiles doctor and ensure it uses the expected checkout. Source differences still require review during recovery.', '公开配置随上面的源码目录提供。若所选条目缺失，请用 dotfiles doctor 核对 CLI 实际使用的配置源，确保指向预期源码目录；源内容变化仍需在恢复时审阅。'),
        state: sourceState,
        dependsOn: ['workstation.cli'],
        actions: sourceActions,
      })
      return steps
    },
  }
}
