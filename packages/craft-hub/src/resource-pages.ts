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

/** Dense, selectable records. Values and actions stay declarative and provider-owned. */
export interface ResourceCollection {
  columns: Array<{ id: string, label: string }>
  rows: Array<{ id: string, cells: Record<string, string>, copyValue: string, credentialKey?: string, input?: ResourceInput }>
  selectedIds: string[]
  selectionInput: string
  filterFormId: string
  hiddenFormIds: string[]
  hiddenDocumentIds: string[]
  /** Document IDs exposed as one-click copy buttons above the collection. */
  copyDocumentIds?: string[]
}

/** A user-opened, isolated browser import. Hosts construct the request; declarations never contain scripts. */
export interface ResourceBrowserImport {
  id: string
  title: string
  url: string
  allowedOrigins: string[]
  formId: string
  request: { path: string, operatorGlobal: string, operatorParameter: string }
  response: { recordsPath: string[], successField: string, successValue: number }
  credentials: { keyField: string, secretField: string, availableField: string, publicFields: string[] }
}

/** A complete page, including navigation, documents and explicitly invoked actions. */
export interface ResourcePage {
  kind: 'resource-page'
  title: string
  description?: string
  input: ResourceInput
  refreshAfterMs?: number
  collection?: ResourceCollection
  browserImport?: ResourceBrowserImport
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
