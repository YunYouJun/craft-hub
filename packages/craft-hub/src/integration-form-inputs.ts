import type { ResourceField, ResourceInput } from './resource-pages'

/** Consistent typed form input for browser and native clients; values remain data, never executable UI. */
export function integrationFormInput(fields: ResourceField[], values: Record<string, string>, base: ResourceInput = {}): Record<string, unknown> {
  const ids = fields.map(field => field.id)
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z]\w*$/i.test(id) || ['constructor', 'prototype', '__proto__'].includes(id)))
    throw new Error('Invalid or duplicate form fields')
  if (Object.keys(values).some(id => !ids.includes(id)))
    throw new Error('The form changed. Reload its fields before submitting.')
  const input: Record<string, unknown> = { ...base }
  for (const field of fields) {
    const raw = values[field.id] ?? String(field.value ?? '')
    const value = field.type === 'textarea' ? raw : raw.trim()
    if (field.type === 'checkbox') {
      if (!['', 'true', 'false'].includes(value))
        throw new Error(`Invalid checkbox: ${field.label}`)
      input[field.id] = value === 'true'
      continue
    }
    if (!value.trim()) {
      if (field.required)
        throw new Error(`Required field: ${field.label}`)
      if (field.type === 'text' || field.type === 'textarea') {
        if (field.value !== undefined)
          input[field.id] = value
      }
      continue
    }
    if (field.type === 'number') {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value)))
        throw new Error(`Invalid number: ${field.label}`)
      input[field.id] = Number(value)
    }
    else if (field.type === 'string-list') {
      const items = value.split(',').map(item => item.trim()).filter(Boolean)
      if (field.required && !items.length)
        throw new Error(`Required field: ${field.label}`)
      input[field.id] = items
    }
    else if (field.type === 'select') {
      if (!field.options?.some(option => option.value === value))
        throw new Error(`Invalid option: ${field.label}`)
      input[field.id] = value
    }
    else if (field.type === 'text' || field.type === 'textarea') {
      input[field.id] = value
    }
    else { throw new Error(`Unsupported field: ${field.label}`) }
  }
  return input
}
