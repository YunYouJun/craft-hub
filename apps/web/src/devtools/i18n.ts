import type { WorkbenchLocale } from 'craft-hub'
import type { Ref } from 'vue'
import { onScopeDispose, ref, watch } from 'vue'

const en = {
  projects: 'Projects',
  diagnostics: 'Diagnostics',
  runs: 'Runs',
  development: 'DEVELOPMENT / READ ONLY',
  subtitle: 'A closer look at your running workbench.',
  language: 'Language',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  refreshFailed: 'Could not refresh the inspector.',
  refreshHint: 'Check the development server and Vite DevTools authentication, then retry.',
  partialFailure: 'Some runtime data is unavailable.',
  startRuntime: 'Start the local runtime with',
  or: 'or',
  thenRefresh: ', then refresh.',
  runtimeOverview: 'Runtime overview',
  runtime: 'Runtime',
  connected: 'Connected',
  connecting: 'Connecting…',
  unavailable: 'Unavailable',
  localHost: 'Local development host',
  trusted: 'Trusted',
  untrusted: 'Untrusted',
  trustCounts: '{trusted} trusted · {untrusted} untrusted',
  diagnosticCounts: '{errors} errors · {warnings} warnings',
  sections: 'Inspector sections',
  projectInspection: 'Project inspection',
  project: 'Project',
  noProjects: 'No registered projects',
  capabilities: 'Discovered capabilities',
  filter: 'Filter capabilities',
  filterHint: 'Filter by name, kind or source…',
  discovering: 'Discovering capabilities…',
  retryDiscovery: 'Retry discovery',
  command: 'Command',
  skill: 'Skill',
  cwd: 'Working directory',
  noMatches: 'No capabilities match this filter.',
  noCapabilities: 'No capabilities discovered for this project.',
  registerProject: 'Register a project in Craft Hub, then refresh to inspect its capabilities.',
  workbenchDiagnostics: 'Workbench diagnostics',
  diagnosticsHint: 'Host plugins, integrations, Marketplace packages and configuration.',
  noDiagnostics: 'No workbench diagnostics. Everything looks clear.',
  diagnosticsUnavailable: 'Diagnostics are unavailable until the runtime responds.',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  recentRuns: 'Recent runs',
  runsHint: 'The latest 30 records across projects. Output logs are omitted.',
  commandProject: 'Command / Project',
  status: 'Status',
  started: 'Started',
  exit: 'Exit',
  running: 'Running',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  noRuns: 'No recent run records available.',
  readOnly: 'Read-only inspection · Project trust stays under Craft Hub control',
  lastFetched: 'Last fetched {time}',
}

type MessageKey = keyof typeof en
const zhCN: Record<MessageKey, string> = {
  projects: '项目',
  diagnostics: '诊断',
  runs: '运行记录',
  development: '开发环境 / 只读检查',
  subtitle: '查看工作台的实时状态与发现结果。',
  language: '语言',
  refresh: '刷新',
  refreshing: '刷新中…',
  refreshFailed: '无法刷新 Inspector。',
  refreshHint: '请检查开发服务器和 Vite DevTools 授权状态，然后重试。',
  partialFailure: '部分运行时数据暂不可用。',
  startRuntime: '请使用',
  or: '或',
  thenRefresh: '启动本地运行时，然后刷新。',
  runtimeOverview: '运行时概览',
  runtime: '运行时',
  connected: '已连接',
  connecting: '连接中…',
  unavailable: '不可用',
  localHost: '本地开发主机',
  trusted: '已信任',
  untrusted: '未信任',
  trustCounts: '{trusted} 个已信任 · {untrusted} 个未信任',
  diagnosticCounts: '{errors} 个错误 · {warnings} 个警告',
  sections: 'Inspector 页面',
  projectInspection: '项目检查',
  project: '项目',
  noProjects: '暂无已注册项目',
  capabilities: '发现的能力',
  filter: '筛选能力',
  filterHint: '按名称、类型或来源筛选…',
  discovering: '正在发现能力…',
  retryDiscovery: '重新发现',
  command: '命令',
  skill: '技能',
  cwd: '工作目录',
  noMatches: '没有符合筛选条件的能力。',
  noCapabilities: '尚未发现此项目的能力。',
  registerProject: '请在 Craft Hub 注册项目，然后刷新以检查其能力。',
  workbenchDiagnostics: '工作台诊断',
  diagnosticsHint: '检查主机插件、集成、市场软件包和配置。',
  noDiagnostics: '暂无工作台诊断，当前状态正常。',
  diagnosticsUnavailable: '运行时响应后即可查看诊断。',
  error: '错误',
  warning: '警告',
  info: '信息',
  recentRuns: '最近运行',
  runsHint: '各项目最近 30 条记录，不包含输出日志。',
  commandProject: '命令 / 项目',
  status: '状态',
  started: '开始时间',
  exit: '退出码',
  running: '运行中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  noRuns: '暂无运行记录。',
  readOnly: '只读检查 · 请在 Craft Hub 中管理项目信任',
  lastFetched: '上次获取 {time}',
}

export const inspectorLocaleKey = 'craft-hub-inspector-locale'

function savedLocale(): WorkbenchLocale {
  try {
    return localStorage.getItem(inspectorLocaleKey) === 'en' ? 'en' : 'zh-CN'
  }
  catch {
    return 'zh-CN'
  }
}

export function useInspectorI18n(): {
  locale: Ref<WorkbenchLocale>
  t: (key: MessageKey, params?: Record<string, string | number>) => string
} {
  const locale = ref<WorkbenchLocale>(savedLocale())
  watch(locale, (value) => {
    document.documentElement.lang = value
    try {
      localStorage.setItem(inspectorLocaleKey, value)
    }
    catch {
      // Language switching still works when browser storage is disabled.
    }
  }, { immediate: true })
  const sync = (event: StorageEvent): void => {
    if (event.key === inspectorLocaleKey || event.key === null)
      locale.value = savedLocale()
  }
  window.addEventListener('storage', sync)
  onScopeDispose(() => window.removeEventListener('storage', sync))

  function t(key: MessageKey, params: Record<string, string | number> = {}): string {
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      (locale.value === 'en' ? en : zhCN)[key],
    )
  }
  return { locale, t }
}
