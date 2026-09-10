import type { IntegrationEntity, IntegrationProviderContext } from './integrations'

/** Inert input resolved by a trusted resource adapter; it never contains executable UI code. */
export type ResourceInput = Record<string, string | number | boolean | null>

/** A schema-driven field in a resource action or document editor. */
export interface ResourceField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'string-list' | 'select' | 'checkbox'
  required?: boolean
  value?: string | number | boolean
  options?: Array<{ label: string, value: string }>
  suggestions?: Array<{ label: string, value: string }>
  placeholder?: string
}

/** A complete page, including navigation, documents and explicitly invoked actions. */
export interface ResourcePage {
  kind: 'resource-page'
  title: string
  description?: string
  input: ResourceInput
  refreshAfterMs?: number
  projectSuggestions?: Array<{ path: string, title: string }>
  entities?: IntegrationEntity[]
  links?: Array<{ title: string, input: ResourceInput, projectId?: string, entityId?: string }>
  documents?: Array<{ id: string, title: string, content: string, filename?: string, compareWith?: string, agentPrompt?: string }>
  forms?: Array<{ id: string, title: string, description?: string, effect: 'read' | 'update' | 'execute', input: ResourceInput, fields: ResourceField[] }>
}

/** Resource adapters own domain semantics; the host owns rendering, trust and confirmation. */
export interface ResourcePageAdapter {
  read: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<ResourcePage>
  update: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<ResourcePage>
  execute: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<ResourcePage>
}
