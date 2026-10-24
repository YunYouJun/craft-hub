import type { ResourceField } from '../src/resource-pages'
import { expect, it } from 'vitest'
import { integrationFormInput } from '../src/integration-form-inputs'

it('normalizes all declarative field types while preserving document whitespace and immutable base input', () => {
  const fields: ResourceField[] = [
    { id: 'title', label: 'Title', type: 'text', required: true },
    { id: 'document', label: 'Document', type: 'textarea' },
    { id: 'count', label: 'Count', type: 'number' },
    { id: 'names', label: 'Names', type: 'string-list' },
    { id: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Preview', value: 'preview' }] },
    { id: 'enabled', label: 'Enabled', type: 'checkbox', value: true },
    { id: 'clear', label: 'Clear', type: 'text', value: 'original' },
    { id: 'optional', label: 'Optional', type: 'number' },
  ]
  const base = { operation: 'save', id: 'document' }
  expect(integrationFormInput(fields, { title: ' Title ', document: '\n  body\n', count: '2.5e2', names: 'alice, , bob', mode: 'preview', clear: '' }, base)).toEqual({ ...base, title: 'Title', document: '\n  body\n', count: 250, names: ['alice', 'bob'], mode: 'preview', enabled: true, clear: '' })
  expect(base).toEqual({ operation: 'save', id: 'document' })
})

it('rejects changed or invalid fields without reflecting user input in errors', () => {
  const field = (type: ResourceField['type']): ResourceField => ({ id: 'value', label: 'Value', type, required: true, options: [{ label: 'Known', value: 'known' }] })
  for (const [type, value] of [['number', 'secret'], ['number', '0xff'], ['number', 'Infinity'], ['select', 'secret'], ['checkbox', 'secret'], ['text', ' '], ['string-list', ', ,']] as const) {
    expect(() => integrationFormInput([field(type)], { value })).toThrow()
    try {
      integrationFormInput([field(type)], { value })
    }
    catch (error) {
      expect(String(error)).not.toContain('secret')
    }
  }
  expect(() => integrationFormInput([field('text')], { unknown: 'secret' })).toThrow('form changed')
  expect(() => integrationFormInput([field('text'), field('text')], {})).toThrow('duplicate')
  expect(() => integrationFormInput([{ ...field('text'), id: '__proto__' }], {})).toThrow('Invalid')
})
