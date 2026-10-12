import type { IntegrationContribution } from 'craft-hub'

export type WorkbenchSection = 'home' | 'projects' | 'tools' | 'environment' | 'workbenches'
export type WorkbenchNavigationView = Pick<IntegrationContribution['views'][number], 'blocks'>

export interface WorkbenchNavigationEntry {
  key: string
  title: string
  icon?: string
  to: string
  match?: 'exact' | 'prefix'
}

export interface WorkbenchNavigationGroup {
  title?: string
  entries: WorkbenchNavigationEntry[]
}

/** Classify environment views by their declared configuration interface. */
export function isEnvironmentView(view?: WorkbenchNavigationView): boolean {
  return view?.blocks.some(block => block.type === 'configuration-manager') ?? false
}

/** Keep existing deep links inside their new top-level navigation section. */
export function classifyWorkbenchSection(routeName: string | symbol | null | undefined, integrationView?: WorkbenchNavigationView): WorkbenchSection | undefined {
  if (routeName === 'overview')
    return 'home'
  if (routeName === 'workbench' || (typeof routeName === 'string' && (routeName === 'subscriptions' || routeName.startsWith('subscriptions-'))))
    return 'projects'
  if (routeName === 'tools' || routeName === 'software' || routeName === 'navigation')
    return 'tools'
  if (routeName === 'environment' || (routeName === 'integration' && isEnvironmentView(integrationView)))
    return 'environment'
  if (routeName === 'workbenches' || routeName === 'plugin-workbench' || routeName === 'integration')
    return 'workbenches'
  return undefined
}
