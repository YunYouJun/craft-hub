import type { CommandInputValues, SkillCapability } from './types'
import { commandInputConditionMatches } from './command-inputs'

export class SkillInputValidationError extends Error {}

/** One validated value selected for an agent skill invocation. */
export interface SkillInputSelection {
  id: string
  label: string
  value: string
}

/** Validate skill inputs and return the visible, non-empty values as structured agent context. */
export function resolveSkillInputSelections(capability: SkillCapability, provided: CommandInputValues = {}): SkillInputSelection[] {
  const definitions = capability.inputs ?? []
  const knownInputs = new Set(definitions.map(input => input.id))
  const unknown = Object.keys(provided).find(input => !knownInputs.has(input))
  if (unknown)
    throw new SkillInputValidationError(`Unknown input for ${capability.name}: ${unknown}`)

  const values = Object.fromEntries(definitions.map(input => [input.id, provided[input.id] ?? input.default ?? '']))
  const selections: SkillInputSelection[] = []

  for (const input of definitions) {
    if (!commandInputConditionMatches(input.visibleWhen, values))
      continue

    const value = values[input.id] ?? ''
    const required = input.required || (input.requiredWhen !== undefined && commandInputConditionMatches(input.requiredWhen, values))
    if (!value) {
      if (required)
        throw new SkillInputValidationError(`${input.label ?? input.id} is required`)
      continue
    }

    if (input.type === 'select' && !input.options?.some(option => option.value === value))
      throw new SkillInputValidationError(`${input.label ?? input.id} must be one of: ${input.options?.map(option => option.value).join(', ') ?? ''}`)
    if (input.pattern && !new RegExp(input.pattern).test(value))
      throw new SkillInputValidationError(`${input.label ?? input.id} has an invalid value`)

    selections.push({ id: input.id, label: input.label ?? input.id, value })
  }

  return selections
}
