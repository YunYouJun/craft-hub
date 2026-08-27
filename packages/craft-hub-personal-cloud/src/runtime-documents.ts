import type { CraftHubRuntime, SettingsExportEnvelope, WorkspaceManifest } from 'craft-hub'
import type { PersonalCloudDocumentSource } from './service'
import type { CloudDocument } from './types'
import { createHash } from 'node:crypto'

export interface RevisionStore {
  get: (key: string) => Promise<string | undefined>
  set: (key: string, revision: string) => Promise<void>
}

/** Translate existing Craft Hub portable interfaces into sync documents. */
export class RuntimeDocumentSource implements PersonalCloudDocumentSource {
  constructor(private readonly runtime: CraftHubRuntime, private readonly revisions: RevisionStore) {}

  async documents(): Promise<CloudDocument[]> {
    const snapshot = await this.runtime.workspaces.portableSnapshot()
    const settings = await this.runtime.settings.export('minimal')
    const payloads: Array<[string, unknown]> = [
      ['settings/global', settings],
      ['workspaces/catalog', {
        schemaVersion: 1,
        workspaceOrder: snapshot.workspaceOrder,
        groups: snapshot.groups,
        workspaceGroups: snapshot.workspaceGroups,
      }],
      ...snapshot.workspaces.map(workspace => [`workspaces/${workspace.id}`, workspace] as [string, WorkspaceManifest]),
    ]
    return Promise.all(payloads.map(async ([key, payload]) => {
      const parentRevision = await this.revisions.get(key)
      const revisionPayload = key === 'settings/global' && isRecord(payload)
        ? { formatVersion: payload.formatVersion, settings: payload.settings }
        : payload
      return {
        key,
        schemaVersion: 1,
        revision: revision(revisionPayload),
        ...(parentRevision ? { parentRevision } : {}),
        payload,
      }
    }))
  }

  async apply(document: CloudDocument): Promise<void> {
    if (document.key === 'settings/global') {
      const current = await this.runtime.settings.get()
      await this.runtime.settings.import(document.payload as SettingsExportEnvelope, 'merge', current.revision)
      return
    }
    if (document.key === 'workspaces/catalog') {
      const payload = document.payload as { workspaceOrder?: unknown, groups?: unknown, workspaceGroups?: unknown }
      if (!Array.isArray(payload.workspaceOrder) || !payload.workspaceOrder.every(id => typeof id === 'string'))
        throw new Error('Cloud workspace order is invalid')
      await this.runtime.workspaces.applyPortableCatalog({
        workspaceOrder: payload.workspaceOrder,
        groups: Array.isArray(payload.groups) ? payload.groups as Array<{ id: string, name: string }> : [],
        workspaceGroups: payload.workspaceGroups && typeof payload.workspaceGroups === 'object' ? payload.workspaceGroups as Record<string, string> : {},
      })
      return
    }
    if (document.key.startsWith('workspaces/')) {
      await this.runtime.workspaces.applyPortableManifest(document.payload as WorkspaceManifest)
      return
    }
    throw new Error(`Unsupported personal cloud document: ${document.key}`)
  }

  commit(key: string, revision: string): Promise<void> {
    return this.revisions.set(key, revision)
  }
}

function revision(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
