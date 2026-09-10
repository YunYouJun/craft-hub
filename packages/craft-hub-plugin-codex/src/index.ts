import type { CraftHubPlugin, IntegrationEntity, IntegrationEntityPage, IntegrationProviderContext } from 'craft-hub'
import type { CodexReader } from './client'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { CatalogCache } from './catalog-cache'
import { CodexMethodUnavailableError, openCodexReader } from './client'
import { configSnapshot, writePluginConfiguration } from './config-file'
import { chinese } from './translations'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function enabled(config: unknown, id: string): boolean | undefined {
  const value = object(object(object(config).plugins)[id]).enabled
  return typeof value === 'boolean' ? value : undefined
}

function state(value: boolean | undefined): string {
  return value === undefined ? 'Inherit' : value ? 'Enabled' : 'Disabled'
}

function layerPath(layer: Record<string, unknown>): string {
  const name = object(layer.name)
  const folder = text(name.dotCodexFolder)
  return text(name.file) ?? (folder ? join(folder, 'config.toml') : text(name.type) ?? 'Unknown source')
}

function disabledReason(layer: Record<string, unknown>): string | undefined {
  return text(layer.disabledReason) ?? text(layer.disabled_reason)
}

/** Project only plugin booleans and source paths; never return raw config or credentials. */
export function configurationRows(globalValue: unknown, projectValue: unknown, inventoryValue: unknown, locale = 'en'): IntegrationEntityPage {
  const t = (value: string): string => locale === 'zh-CN' ? chinese[value] ?? value : value
  const source = (label: string, value: string, layer?: Record<string, unknown>): { label: string, value: string, sourcePath?: string } => {
    const path = layer ? layerPath(layer) : undefined
    return { label: t(label), value: t(value), ...(path && isAbsolute(path) ? { sourcePath: path } : {}) }
  }
  const preview = object(inventoryValue).installationPending === true
  const global = object(globalValue)
  const project = object(projectValue)
  if (!global.config || !project.config || !Array.isArray(project.layers) || !Array.isArray(object(inventoryValue).marketplaces))
    throw new Error('Unsupported Codex configuration response. Update the local Codex CLI.')
  const layers = array(project.layers).map(object)
  const projectLayers = layers.filter(layer => object(layer.name).type === 'project')
  const inventory = new Map<string, Record<string, unknown>>()
  for (const rawMarketplace of array(object(inventoryValue).marketplaces)) {
    const marketplace = object(rawMarketplace)
    for (const rawPlugin of array(marketplace.plugins)) {
      const plugin = object(rawPlugin)
      const id = text(plugin.id)
      if (id && plugin.installed === true)
        inventory.set(id.includes('@') ? id : `${id}@${marketplace.name}`, plugin)
    }
  }
  const ids = new Set([...inventory.keys(), ...Object.keys(object(object(global.config).plugins)), ...Object.keys(object(object(project.config).plugins))])
  for (const layer of projectLayers) {
    for (const id of Object.keys(object(object(layer.config).plugins)))
      ids.add(id)
  }
  const items: IntegrationEntity[] = [...ids].sort().map((id) => {
    const plugin = inventory.get(id)
    const globalFlag = enabled(global.config, id)
    const effectiveFlag = enabled(project.config, id)
    const appliedLayer = layers.find(layer => !disabledReason(layer) && enabled(layer.config, id) !== undefined)
    const globalLayer = array(global.layers).map(object).find(layer => !disabledReason(layer) && enabled(layer.config, id) !== undefined)
    const overrides = projectLayers.filter(layer => enabled(layer.config, id) !== undefined)
    const fallback = typeof plugin?.enabled === 'boolean' ? plugin.enabled : undefined
    const effective = effectiveFlag ?? fallback
    return {
      id,
      title: text(object(plugin?.interface).displayName) ?? text(plugin?.name) ?? id,
      status: t(preview ? 'Checking installation' : !plugin ? 'Not confirmed installed' : effective === undefined ? 'Unknown' : effective ? 'Configured enabled' : 'Disabled'),
      description: id,
      details: [
        source('Installed version', preview ? 'Checking installation' : text(plugin?.localVersion) ?? text(plugin?.version) ?? (plugin ? 'Unknown version' : 'Not in installed catalog')),
        source('Global configuration', state(globalFlag)),
        ...(globalLayer ? [source('Global source', layerPath(globalLayer), globalLayer)] : []),
        ...(overrides.length ? overrides.map(layer => source('Project override', `${t(state(enabled(layer.config, id)))}${disabledReason(layer) ? t(' (ignored)') : ''} — ${layerPath(layer)}`, layer)) : [source('Project override', 'Follow parent settings')]),
        source('Effective source', appliedLayer ? layerPath(appliedLayer) : 'Codex catalog default (no explicit configuration)', appliedLayer),
      ],
    }
  })
  if (preview && !items.length)
    items.push({ id: 'installation-pending', title: t('Checking installation'), status: t('Checking installation') })
  for (const [index, layer] of projectLayers.entries()) {
    if (disabledReason(layer)) {
      items.unshift({ id: `diagnostic:layer:${index}`, title: t('Project configuration ignored'), status: t('Needs attention'), details: [source('Source', layerPath(layer), layer)], description: t('Project configuration ignored by Codex. Review project trust and configuration.') })
    }
  }
  if (array(object(inventoryValue).marketplaceLoadErrors).length)
    items.unshift({ id: 'diagnostic:catalog', title: t('Plugin catalog is incomplete'), status: t('Needs attention'), description: t('Some marketplaces could not be read. Missing entries do not prove a plugin is uninstalled.') })
  return { items }
}

/** Retain only installed-plugin display fields, not the full remote marketplace payload. */
function compactInventory(value: unknown): unknown {
  const inventory = object(value)
  if (!Array.isArray(inventory.marketplaces))
    throw new Error('Unsupported Codex configuration response. Update the local Codex CLI.')
  return {
    marketplaces: inventory.marketplaces.map((entry) => {
      const market = object(entry)
      return {
        name: market.name,
        plugins: array(market.plugins).map(object).filter(plugin => plugin.installed === true).map(plugin => ({
          id: plugin.id,
          name: plugin.name,
          installed: true,
          enabled: plugin.enabled,
          localVersion: plugin.localVersion,
          version: plugin.version,
          interface: { displayName: object(plugin.interface).displayName },
        })),
      }
    }),
    marketplaceLoadErrors: array(inventory.marketplaceLoadErrors).map(() => ({})),
  }
}

/** Create a scoped configuration Host Plugin. The reader is injectable for offline tests. */
export function createCodexConfigurationPlugin(openReader: () => Promise<CodexReader> = openCodexReader, writeConfiguration = writePluginConfiguration): CraftHubPlugin {
  const catalogs = new CatalogCache()
  async function readSnapshot(context: IntegrationProviderContext, input?: Record<string, unknown>, existingInventory?: unknown): Promise<{ page: IntegrationEntityPage, path?: string }> {
    const reader = await openReader()
    try {
      const global = await reader.read('config/read', { includeLayers: true, cwd: homedir() })
      const project = context.projectPath ? await reader.read('config/read', { includeLayers: true, cwd: context.projectPath }) : global
      if (input?.preview === true)
        return { page: configurationRows(global, project, { marketplaces: [], installationPending: true }, context.locale) }
      const inventory = existingInventory ?? await catalogs.get(context.projectPath ?? '', async () => {
        const params = { cwds: context.projectPath ? [context.projectPath] : [] }
        try {
          return compactInventory(await reader.read('plugin/installed', params))
        }
        catch (error) {
          if (!(error instanceof CodexMethodUnavailableError))
            throw error
          return compactInventory(await reader.read('plugin/list', { ...params, forceRefetch: false }))
        }
      })
      const page = configurationRows(global, project, inventory, context.locale)
      const layers = array(object(project).layers).map(object)
      const user = array(object(global).layers).map(object).find(layer => object(layer.name).type === 'user')
      const path = context.projectPath ? join(context.projectPath, '.codex', 'config.toml') : user ? layerPath(user) : undefined
      const target = layers.find(layer => layerPath(layer) === path)
      if (path && isAbsolute(path) && !layers.some(layer => object(layer.name).type === 'project' && disabledReason(layer))) {
        const snapshot = await configSnapshot(path).catch(() => undefined)
        for (const item of snapshot ? page.items : []) {
          if (item.id.startsWith('diagnostic:'))
            continue
          const effective = enabled(object(project).config, item.id)
          const explicit = enabled(target?.config, item.id)
          const catalogPlugin = array(object(inventory).marketplaces).flatMap(market => array(object(market).plugins)).map(object).find(plugin => plugin.id === item.id)
          const flag = effective ?? (typeof catalogPlugin?.enabled === 'boolean' ? catalogPlugin.enabled : undefined)
          if (flag !== undefined && catalogPlugin)
            item.configurationToggle = { enabled: flag, inherited: explicit === undefined, revision: snapshot!.revision, scope: context.projectPath ? 'project' : 'global' }
        }
      }
      return { page, path }
    }
    finally {
      reader.close()
    }
  }
  return {
    id: '@craft-hub/craft-hub-plugin-codex',
    name: 'Codex configuration',
    version: '0.1.0',
    integrationProviders: [{
      id: 'codex-configuration',
      apiVersion: '1.0.0',
      connectionStatus: async () => ({ connected: true, message: 'Local Codex configuration adapter' }),
      configuration: {
        async update(context, input) {
          if (!context.confirmed || typeof input.id !== 'string' || !/^[a-z0-9][\w.-]*@[a-z0-9][\w.-]*$/i.test(input.id) || (typeof input.enabled !== 'boolean' && input.enabled !== null) || typeof input.revision !== 'string')
            throw new Error('Invalid configuration update.')
          if (input.enabled === null && !context.projectPath)
            throw new Error('Only project overrides can be reset.')
          const inventory = catalogs.peek(context.projectPath ?? '')
          if (!inventory)
            throw new Error('Refresh the plugin list before updating configuration.')
          const { page, path } = await readSnapshot(context, undefined, inventory)
          const row = page.items.find(item => item.id === input.id)
          if (!row?.configurationToggle)
            throw new Error('Plugin configuration is not editable. Refresh and check project trust.')
          if (row.configurationToggle.revision !== input.revision)
            throw new Error('Configuration changed. Refresh and try again.')
          if (!path || !isAbsolute(path))
            throw new Error('Configuration source is unavailable.')
          await writeConfiguration(path, input.id, input.enabled, input.revision)
          return (await readSnapshot(context, undefined, inventory)).page
        },
        list: async (context, input) => (await readSnapshot(context, input)).page,
      },
    }],
    integrations: [{
      translations: { 'zh-CN': chinese },
      id: 'codex-configuration',
      provider: { id: 'codex-configuration', requires: '^1.0.0' },
      actions: [{ id: 'configuration', title: 'Read plugin configuration', operation: 'configuration.list', effect: 'local-read', confirmation: 'never' }, { id: 'update-configuration', title: 'Update plugin configuration', operation: 'configuration.update', effect: 'local-write', confirmation: 'risk-based' }],
      views: [{ id: 'plugins', title: 'Codex', icon: 'builtin:terminal', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'plugins', title: 'Plugin configuration', description: 'Switches apply to the selected scope. Existing Codex tasks may need to be reopened.', type: 'entity-list', actionId: 'configuration', previewInput: { preview: true } }] }],
    }],
  }
}

export default createCodexConfigurationPlugin()
