import type { CommandCapability, CommandInputCondition, CommandInputValues, CommandInvocation } from './types'

export class CommandInputValidationError extends Error {}

/** Return whether a command-input condition matches the effective input values. */
export function commandInputConditionMatches(condition: CommandInputCondition | undefined, values: CommandInputValues): boolean {
  return condition === undefined || values[condition.input] === condition.equals
}

/** Validate command inputs and resolve them into a structured invocation without invoking a shell. */
export function resolveCommandInvocation(capability: CommandCapability, provided: CommandInputValues = {}): CommandInvocation {
  const definitions = capability.inputs ?? []
  const knownInputs = new Set(definitions.map(input => input.id))
  const unknown = Object.keys(provided).find(input => !knownInputs.has(input))
  if (unknown)
    throw new CommandInputValidationError(`Unknown input for ${capability.name}: ${unknown}`)

  const values = Object.fromEntries(definitions.map(input => [input.id, provided[input.id] ?? input.default ?? '']))
  const args = [...capability.invocation.args]
  const inputArgs: string[] = []

  for (const input of definitions) {
    if (!commandInputConditionMatches(input.visibleWhen, values))
      continue

    const value = values[input.id] ?? ''
    const required = input.required || (input.requiredWhen !== undefined && commandInputConditionMatches(input.requiredWhen, values))
    if (!value) {
      if (required)
        throw new CommandInputValidationError(`${input.label ?? input.id} is required`)
      continue
    }

    if (input.type === 'select' && !input.options?.some(option => option.value === value))
      throw new CommandInputValidationError(`${input.label ?? input.id} must be one of: ${input.options?.map(option => option.value).join(', ') ?? ''}`)
    if (input.pattern && !new RegExp(input.pattern).test(value))
      throw new CommandInputValidationError(`${input.label ?? input.id} has an invalid value`)

    if (input.argumentStyle === 'separate')
      inputArgs.push(input.flag, value)
    else
      inputArgs.push(`${input.flag}=${value}`)
  }

  if (inputArgs.length && capability.inputArgSeparator)
    args.push(capability.inputArgSeparator)
  args.push(...inputArgs)

  return { ...capability.invocation, args }
}
