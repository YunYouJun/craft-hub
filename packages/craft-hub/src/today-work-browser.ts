import type { IntegrationEntityPage } from './integrations'
import type { WorkItemActionContext, WorkItemActionTarget } from './work-item-action-target'
import { createHash } from 'node:crypto'
import { workItemActionTarget } from './work-item-action-target'
import { isWorkItemDueToday, isWorkItemOverdue, personalActiveWork, workItemIdentityKey } from './work-items'

/** Task browser projection; action targets retain provider identity without authorizing operations. */
export interface TodayWorkBrowser {
  accountKey?: string
  collections: { key: string, title: string }[]
  projectMode: boolean
  fetchedAt?: string
  items: {
    key: string
    title: string
    collectionKey?: string
    status?: string
    type?: string
    url?: string
    due?: string
    actionTarget?: WorkItemActionTarget
    categories: ('important' | 'overdue' | 'planned' | 'today')[]
  }[]
}

/** Project only personal unfinished tasks, sharing classification rules with the browser UI. */
export function todayWorkBrowser(page: IntegrationEntityPage, now: number, context?: WorkItemActionContext): TodayWorkBrowser {
  const items = personalActiveWork(page)
  const projectMode = page.items.some(item => item.project)
  const key = (value: string): string => createHash('sha256').update(value).digest('hex')
  const collections = projectMode
    ? [...new Map(items.flatMap(item => item.project ? [[item.project.id, item.project] as const] : [])).values()]
    : page.collections ?? []
  return {
    ...(page.currentUser ? { accountKey: key(page.currentUser.id) } : {}),
    projectMode,
    collections: collections.map(collection => ({ key: key(collection.id), title: collection.title })),
    ...(page.fetchedAt ? { fetchedAt: page.fetchedAt } : {}),
    items: items.map(item => ({
      key: key(workItemIdentityKey(item)),
      title: item.title,
      ...((projectMode ? item.project?.id : item.sourceRef?.containerId) ? { collectionKey: key((projectMode ? item.project?.id : item.sourceRef?.containerId)!) } : {}),
      ...(item.statusLabel || item.status ? { status: item.statusLabel ?? item.status } : {}),
      ...(item.type ? { type: item.type.title } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.dueDate ? { due: item.dueDate.dateTime.slice(0, 10) } : {}),
      ...(context ? { actionTarget: workItemActionTarget(item, page, context) } : {}),
      categories: [
        ...(item.important ? ['important' as const] : []),
        ...(isWorkItemOverdue(item.dueDate, now) ? ['overdue' as const] : []),
        ...(item.dueDate || item.reminderDate ? ['planned' as const] : []),
        ...(isWorkItemDueToday(item.dueDate, now) ? ['today' as const] : []),
      ],
    })),
  }
}
