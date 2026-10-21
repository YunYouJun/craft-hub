import type { IntegrationConnectionStatus, IntegrationEntityPage } from 'craft-hub'
import type { HomeWorkSource } from './personal-workbench'
import { defineStore } from 'pinia'
import { onScopeDispose, reactive, ref, watch } from 'vue'
import { api, ApiRequestError } from './api'
import { useI18n } from './i18n'
import { subscribeIntegrationChanges } from './integration-action-events'
import { homeWorkSources } from './personal-workbench'
import { useWorkbenchStore } from './store'
import { mergeIntegrationEntityPages } from './work-item-pagination'

export interface SourceState {
  page?: IntegrationEntityPage
  loading: boolean
  error?: string
  connection?: IntegrationConnectionStatus
  fetchedAt?: string
  cursors: string[]
  expanded?: boolean
  retryMore?: boolean
}

interface SourceRecord { source: HomeWorkSource, signature: string, loadedAt?: number }
interface ConnectionRecord {
  integrationId: string
  status?: IntegrationConnectionStatus
  checkedAt?: number
  promise?: Promise<IntegrationConnectionStatus | undefined>
  accountId?: string
}
interface SourceFlight { phase: 'connection' | 'list', promise: Promise<void> }

const freshnessMs = 60_000

/** Connection inputs identify account scopes independently of each list's query. */
export function connectionKey(source: HomeWorkSource): string {
  return JSON.stringify([source.integrationId, source.connection?.actionId, Object.entries(source.connection?.input ?? {}).sort(([left], [right]) => left.localeCompare(right))])
}

/** Session memory survives page navigation; account snapshots never enter browser persistence. */
export const useHomeWorkDataStore = defineStore('home-work-data', () => {
  const workbench = useWorkbenchStore()
  const { locale } = useI18n()
  const states = reactive<Record<string, SourceState>>({})
  const revision = ref(0)
  const catalog = new Map<string, SourceRecord>()
  const connections = new Map<string, ConnectionRecord>()
  const flights = new Map<string, SourceFlight>()
  const mutations = new Map<string, number>()
  const copy = (zh: string, en: string): string => locale.value === 'zh-CN' ? zh : en

  function stateFor(source: HomeWorkSource): SourceState {
    states[source.key] ??= { loading: false, cursors: [] }
    return states[source.key]!
  }

  function clearSnapshot(key: string): void {
    const state = states[key]
    if (state) {
      state.page = undefined
      state.fetchedAt = undefined
      state.error = undefined
      state.cursors = []
      state.expanded = undefined
      state.retryMore = false
    }
    const record = catalog.get(key)
    if (record)
      record.loadedAt = undefined
  }

  function cancelSource(key: string): void {
    flights.delete(key)
    if (states[key])
      states[key]!.loading = false
  }

  /** Clear account siblings immediately, and prevent their old reads from restoring that account. */
  function clearAccount(key: string, keepFlight?: SourceFlight, refreshSiblings = false): void {
    let clearedSibling = false
    for (const [sourceKey, record] of catalog) {
      if (connectionKey(record.source) !== key)
        continue
      const pending = flights.get(sourceKey)
      if (pending !== keepFlight && (states[sourceKey]?.page || pending?.phase === 'list'))
        clearedSibling = true
      clearSnapshot(sourceKey)
      // Other lists awaiting this same status answer can safely continue with the new connection.
      if (pending?.phase === 'list' && pending !== keepFlight)
        cancelSource(sourceKey)
    }
    if (refreshSiblings && clearedSibling)
      revision.value++
  }

  function publishConnection(key: string, status: IntegrationConnectionStatus): void {
    for (const [sourceKey, record] of catalog) {
      if (connectionKey(record.source) === key && states[sourceKey])
        states[sourceKey]!.connection = status
    }
  }

  function connectionFresh(record: ConnectionRecord | undefined): boolean {
    if (!record?.status?.connected || record.checkedAt === undefined || Date.now() - record.checkedAt >= freshnessMs || record.status.session?.cacheReads === false)
      return false
    const expiresAt = record.status.session?.expiresAt
    return !expiresAt || Date.parse(expiresAt) > Date.now()
  }

  function checkConnection(source: HomeWorkSource, force: boolean): Promise<IntegrationConnectionStatus | undefined> {
    const key = connectionKey(source)
    let record = connections.get(key)
    if (record?.promise)
      return record.promise
    if (!force && connectionFresh(record))
      return Promise.resolve(record!.status)
    record ??= { integrationId: source.integrationId }
    connections.set(key, record)
    const current = record
    current.promise = api.invokeIntegrationAction<IntegrationConnectionStatus>(source.integrationId, source.connection!.actionId, source.connection!.input)
      .then((status) => {
        if (connections.get(key) !== current || typeof status.connected !== 'boolean')
          return undefined
        const previousIdentity = current.status?.session?.cacheKey
        const nextIdentity = status.session?.cacheKey
        if (status.connected === false || (previousIdentity !== undefined && nextIdentity !== undefined && previousIdentity !== nextIdentity)) {
          clearAccount(key, undefined, status.connected)
          current.accountId = undefined
        }
        current.status = status
        current.checkedAt = Date.now()
        publishConnection(key, status)
        return status
      })
      .catch((caught: unknown) => {
        // Authentication failures must clear account snapshots; optional network status failures may still read.
        if (caught instanceof ApiRequestError && [401, 403].includes(caught.status))
          throw caught
        return undefined
      })
      .finally(() => {
        if (connections.get(key) === current)
          current.promise = undefined
      })
    return current.promise
  }

  function snapshotFresh(source: HomeWorkSource, state: SourceState, record: SourceRecord): boolean {
    if (!state.page || state.error || state.page.cache || record.loadedAt === undefined || Date.now() - record.loadedAt >= freshnessMs)
      return false
    const connection = connections.get(connectionKey(source))
    if (source.connection && !connectionFresh(connection))
      return false
    // A provider must identify an account before its personal-work result can skip revalidation.
    return Boolean(state.page.currentUser?.id)
  }

  function load(source: HomeWorkSource, options: { force?: boolean, more?: boolean } = {}): Promise<void> {
    if (mutations.has(source.integrationId))
      return Promise.resolve()
    const record = catalog.get(source.key)
    if (!record)
      return Promise.resolve()
    source = record.source
    const pending = flights.get(source.key)
    if (pending)
      return pending.promise
    const state = stateFor(source)
    let cursor = options.more ? state.page?.nextCursor : undefined
    if ((options.more && !cursor) || (!options.more && !options.force && snapshotFresh(source, state, record)))
      return Promise.resolve()
    const flight: SourceFlight = { phase: 'connection', promise: Promise.resolve() }
    flights.set(source.key, flight)
    state.loading = true
    state.retryMore = Boolean(options.more)
    state.error = undefined
    const current = (): boolean => flights.get(source.key) === flight && catalog.get(source.key) === record && states[source.key] === state
    flight.promise = (async () => {
      try {
        if (source.connection) {
          const connection = await checkConnection(source, Boolean(options.force))
          if (!current())
            return
          // A failed optional check must not leave a stale disconnected prompt over a successful read.
          if (connection || state.connection?.connected === false)
            state.connection = connection
          if (connection?.connected === false)
            return
          // A changed account invalidates continuation tokens as well as its visible snapshot.
          if (cursor && !state.page) {
            cursor = undefined
            state.retryMore = false
          }
        }
        flight.phase = 'list'
        const page = await api.invokeIntegrationAction<IntegrationEntityPage>(source.integrationId, source.actionId, { ...source.input, ...(cursor ? { cursor } : {}) })
        if (!current())
          return
        const key = connectionKey(source)
        const connection = connections.get(key)
        const previous = state.page
        const previousAccount = connection?.accountId ?? previous?.currentUser?.id
        if (previousAccount && page.currentUser?.id && previousAccount !== page.currentUser.id) {
          clearAccount(key, flight, connection?.status?.connected === true)
          if (connection)
            connection.accountId = undefined
        }
        if (cursor && previous) {
          const merged = mergeIntegrationEntityPages(previous, page)
          state.page = merged.page
          if (merged.identityChanged) {
            state.cursors = []
            state.error = copy('来源账号已变化，已清除旧账号的分页结果。', 'Source account changed; previous account results were cleared.')
          }
          else {
            state.cursors.push(cursor)
          }
        }
        else {
          state.page = page
          state.cursors = []
        }
        if (state.page.nextCursor && state.cursors.includes(state.page.nextCursor)) {
          state.page = { ...state.page, nextCursor: undefined, coverage: 'partial' }
          state.retryMore = false
          state.error = copy('来源返回了重复的分页游标，请刷新或进入来源查看。', 'The source returned a repeated cursor. Refresh or open the source.')
        }
        if (connection && page.currentUser?.id)
          connection.accountId = page.currentUser.id
        state.fetchedAt = page.fetchedAt ?? new Date().toISOString()
        record.loadedAt = Date.now()
        if (options.more)
          state.expanded = true
      }
      catch (caught) {
        if (!current())
          return
        if (caught instanceof ApiRequestError && [401, 403].includes(caught.status)) {
          const key = connectionKey(source)
          clearAccount(key, flight)
          connections.delete(key)
          publishConnection(key, { connected: false })
        }
        state.error = copy('无法读取工作事项，请在集成中检查连接。', 'Could not load work items. Check the connection in this integration.')
      }
      finally {
        if (current()) {
          state.loading = false
          flights.delete(source.key)
        }
      }
    })()
    return flight.promise
  }

  function invalidate(integrationId?: string): void {
    for (const [key, record] of catalog) {
      if (integrationId && record.source.integrationId !== integrationId)
        continue
      cancelSource(key)
      clearSnapshot(key)
      if (states[key])
        states[key]!.connection = undefined
    }
    for (const [key, record] of connections) {
      if (!integrationId || record.integrationId === integrationId)
        connections.delete(key)
    }
    revision.value++
  }

  // Reconcile against the full contribution catalog, independently of any component's source filters.
  watch(() => ({ ready: workbench.integrationsLoadState === 'ready', sources: homeWorkSources(workbench.integrationContributions, locale.value).map((source) => {
    const contribution = workbench.integrationContributions.find(item => item.id === source.integrationId)!
    return { source, signature: JSON.stringify([source, contribution.pluginId, contribution.source, contribution.providerVersion]) }
  }) }), ({ sources, ready }) => {
    const retained = new Set(sources.map(item => item.source.key))
    for (const key of catalog.keys()) {
      if (ready && !retained.has(key)) {
        cancelSource(key)
        catalog.delete(key)
        delete states[key]
      }
    }
    for (const { source, signature } of sources) {
      const previous = catalog.get(source.key)
      if (previous?.signature === signature)
        continue
      if (previous) {
        cancelSource(source.key)
        clearSnapshot(source.key)
        const previousConnection = connectionKey(previous.source)
        connections.delete(previousConnection)
        for (const [siblingKey, sibling] of catalog) {
          if (connectionKey(sibling.source) === previousConnection)
            cancelSource(siblingKey)
        }
        if (states[source.key])
          states[source.key]!.connection = undefined
      }
      catalog.set(source.key, { source, signature })
    }
    const retainedConnections = new Set([...catalog.values()].map(record => connectionKey(record.source)))
    for (const key of connections.keys()) {
      if (!retainedConnections.has(key))
        connections.delete(key)
    }
  }, { immediate: true, flush: 'sync' })

  const unsubscribe = subscribeIntegrationChanges(({ integrationId, phase }) => {
    if (phase === 'start')
      mutations.set(integrationId, (mutations.get(integrationId) ?? 0) + 1)
    else if ((mutations.get(integrationId) ?? 0) > 1)
      mutations.set(integrationId, mutations.get(integrationId)! - 1)
    else
      mutations.delete(integrationId)
    invalidate(integrationId)
  })
  onScopeDispose(unsubscribe)

  return { states, revision, stateFor, load, invalidate }
})
