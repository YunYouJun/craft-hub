import type { EnvironmentSetupSnapshot, EnvironmentSetupStep, SetupProfileResolution, SetupProfileReview } from 'craft-hub'

/** Localized display text in the shape used by setup steps. */
export interface ReadinessText { en: string, zh?: string }
/** Ordered machine stages that the current setup and profile observations can support. */
export type ReadinessStageId = 'system' | 'package-manager' | 'runtime' | 'sources' | 'software' | 'configuration'
/** Display state; only a confirmed `ready` counts toward readiness. */
export type ReadinessItemState = 'ready' | 'action-required' | 'blocked' | 'missing' | 'review' | 'unknown'
/** One observed prerequisite or profile entry, with the existing page that reviews it. */
export interface ReadinessItem {
  key: string
  stage: ReadinessStageId
  title: ReadinessText
  description?: ReadinessText
  state: ReadinessItemState
  /** False when the latest read failed and this is a retained earlier observation. */
  confirmed: boolean
  /** Unsatisfied `dependsOn` prerequisites, by title. */
  waitingOn: ReadinessText[]
  to: ReadinessLocation
}
/** Router destination; the home never performs the step itself. */
export interface ReadinessLocation { path: string, query?: Record<string, string> }
/** The single most useful navigation target, or a read-only recheck after a failed read. */
export type ReadinessNextAction
  = | { kind: 'link', title: ReadinessText, detail?: ReadinessText, to: ReadinessLocation }
    | { kind: 'recheck', title: ReadinessText, detail: ReadinessText }
/** Readiness counts for one stage. */
export interface ReadinessStage { id: ReadinessStageId, title: ReadinessText, ready: number, total: number, items: ReadinessItem[] }
/** Profile entries that differ from this machine. Versions are not compared because neither contract records them. */
export interface ReadinessDifferences { missing: ReadinessItem[], review: ReadinessItem[], unconfirmed: ReadinessItem[] }
/** Aggregated read-only view composed from existing setup and profile reads. */
export interface MachineReadiness {
  stages: ReadinessStage[]
  items: ReadinessItem[]
  ready: number
  total: number
  /** Ready in a retained, now unconfirmed observation. Never counted as ready. */
  previouslyReady: number
  /** True only for a saved profile whose every item was freshly verified ready. */
  environmentReady: boolean
  hasProfile: boolean | undefined
  blockers: ReadinessItem[]
  differences: ReadinessDifferences
  next?: ReadinessNextAction
}
/** Latest successful reads plus whether the most recent attempt for each failed. */
export interface MachineReadinessInput {
  setup?: EnvironmentSetupSnapshot
  review?: SetupProfileReview
  setupFailed?: boolean
  reviewFailed?: boolean
}

const words = (en: string, zh: string): ReadinessText => ({ en, zh })
const setupPage: ReadinessLocation = { path: '/environment/setup' }
const stageTitles: Record<ReadinessStageId, ReadinessText> = {
  'system': words('System tools', '系统工具'),
  'package-manager': words('Package manager', '包管理器'),
  'runtime': words('Runtime', '运行时'),
  'sources': words('Engine and sources', '环境引擎与配置源'),
  'software': words('Software', '软件'),
  'configuration': words('Configuration', '配置'),
}
const stageOrder = Object.keys(stageTitles) as ReadinessStageId[]
const satisfied = (state: EnvironmentSetupStep['state'] | undefined): boolean => state === 'ready' || state === 'not-required'

function stepStage(id: string): ReadinessStageId {
  if (id === 'platform' || id === 'developer-tools')
    return 'system'
  if (id === 'homebrew')
    return 'package-manager'
  if (id === 'node' || id.endsWith('.node'))
    return 'runtime'
  return 'sources'
}

/** Titles of prerequisites a step still waits for; satisfied dependencies are omitted. */
export function waitingOn(step: EnvironmentSetupStep, steps: EnvironmentSetupStep[]): ReadinessText[] {
  if (satisfied(step.state))
    return []
  return step.dependsOn.flatMap((id) => {
    const dependency = steps.find(candidate => candidate.id === id)
    return satisfied(dependency?.state) ? [] : [dependency?.title ?? { en: id }]
  })
}

function profileState(state: SetupProfileResolution): ReadinessItemState {
  if (state === 'ready' || state === 'missing')
    return state
  return state === 'review' || state === 'changed' ? 'review' : 'unknown'
}

/** Compose existing read-only observations; unknown, unavailable and stale entries never count as ready. */
export function machineReadiness(input: MachineReadinessInput): MachineReadiness {
  const steps = input.setup?.steps ?? []
  const items: ReadinessItem[] = steps.filter(step => step.state !== 'not-required').map(step => ({
    key: `step:${step.id}`,
    stage: stepStage(step.id),
    title: step.title,
    description: step.description,
    state: step.state as ReadinessItemState,
    confirmed: !input.setupFailed,
    waitingOn: waitingOn(step, steps),
    to: setupPage,
  }))
  for (const entry of input.review?.software ?? []) {
    const state = profileState(entry.state)
    items.push({
      key: `software:${entry.reference.sourceId}:${entry.reference.softwareId}`,
      stage: 'software',
      title: entry.reference.title,
      state,
      confirmed: !input.reviewFailed,
      waitingOn: [],
      to: entry.canInstall ? { path: '/software', query: { setup: '1' } } : setupPage,
    })
  }
  for (const entry of input.review?.configurations ?? []) {
    items.push({
      key: `configuration:${entry.reference.integrationId}:${entry.reference.itemId}`,
      stage: 'configuration',
      title: { en: entry.reference.title },
      state: profileState(entry.state),
      confirmed: !input.reviewFailed,
      waitingOn: [],
      to: entry.href ? { path: entry.href, query: { scope: 'global', setupItem: entry.reference.itemId } } : setupPage,
    })
  }
  items.sort((left, right) => stageOrder.indexOf(left.stage) - stageOrder.indexOf(right.stage))
  const isReady = (item: ReadinessItem): boolean => item.confirmed && item.state === 'ready'
  const stages = stageOrder.map((id) => {
    const members = items.filter(item => item.stage === id)
    return { id, title: stageTitles[id], ready: members.filter(isReady).length, total: members.length, items: members }
  }).filter(stage => stage.total > 0)
  const ready = items.filter(isReady).length
  const failed = !!(input.setupFailed || input.reviewFailed)
  const hasProfile = input.review ? input.review.snapshot.profile !== null : undefined
  const profileItems = items.filter(item => item.stage === 'software' || item.stage === 'configuration')
  const differences: ReadinessDifferences = {
    missing: profileItems.filter(item => item.confirmed && item.state === 'missing'),
    review: profileItems.filter(item => item.confirmed && item.state === 'review'),
    unconfirmed: profileItems.filter(item => !item.confirmed || item.state === 'unknown'),
  }
  return {
    stages,
    items,
    ready,
    total: items.length,
    previouslyReady: items.filter(item => !item.confirmed && item.state === 'ready').length,
    environmentReady: !failed && hasProfile === true && !!input.setup && items.length > 0 && ready === items.length,
    hasProfile,
    blockers: items.filter(item => item.key.startsWith('step:') && !isReady(item)),
    differences,
    next: nextAction(items, failed, hasProfile, !!input.setup),
  }
}

function nextAction(items: ReadinessItem[], failed: boolean, hasProfile: boolean | undefined, observed: boolean): ReadinessNextAction | undefined {
  if (failed) {
    return { kind: 'recheck', title: words('Check this machine again', '重新检查这台电脑'), detail: words('The latest check failed. Earlier results are kept below but are not confirmed.', '最近一次检查失败。下方保留上次结果，但当前状态未确认。') }
  }
  const step = items.find(item => item.key.startsWith('step:') && item.state === 'action-required')
  if (step)
    return { kind: 'link', title: step.title, detail: step.description, to: step.to }
  if (hasProfile === false)
    return { kind: 'link', title: words('Save my environment profile', '保存我的环境方案'), detail: words('Choose the software and configuration this machine should have, then compare it with this machine.', '选择这台电脑应具备的软件与配置，再与本机实际状态对比。'), to: setupPage }
  const missing = items.filter(item => item.stage === 'software' && item.state === 'missing')
  if (missing.length) {
    const installable = missing.some(item => item.to.path === '/software')
    return {
      kind: 'link',
      title: installable ? words(`Review installing ${missing.length} missing software`, `在软件中心审阅安装 ${missing.length} 项缺失软件`) : words(`Review ${missing.length} missing software`, `查看 ${missing.length} 项缺失软件`),
      detail: words('Installation runs only after you review the plan in Software center.', '安装需在软件中心审阅计划并确认后才会执行。'),
      to: installable ? { path: '/software', query: { setup: '1' } } : setupPage,
    }
  }
  const review = items.find(item => item.state === 'review' || item.state === 'missing')
  if (review) {
    return { kind: 'link', title: { en: `Review ${review.title.en}`, zh: `审阅：${review.title.zh ?? review.title.en}` }, detail: words('Configuration on this machine differs from the profile source. Review it before applying.', '本机配置与方案来源不一致，请审阅后再应用。'), to: review.to }
  }
  if (items.some(item => item.state !== 'ready') || !observed)
    return { kind: 'link', title: words('Confirm unknown items', '确认尚未确认的项目'), detail: words('Some states could not be detected. Open the setup guide to see what is needed and check again.', '部分状态无法检测。打开准备引导查看需要什么，然后重新检查。'), to: setupPage }
  return undefined
}
