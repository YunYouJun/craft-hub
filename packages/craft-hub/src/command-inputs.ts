import type { CommandCapability, CommandInputConditions, CommandInputValues, CommandInvocation } from './types'

/** Error raised when provided command-input values violate their declarations. */
export class CommandInputValidationError extends Error {}

/** Return whether a command-input condition matches the effective input values. */
export function commandInputConditionMatches(condition: CommandInputConditions | undefined, values: CommandInputValues): boolean {
  if (condition === undefined)
    return true
  const conditions = Array.isArray(condition) ? condition : [condition]
  return conditions.every(item => values[item.input] === item.equals)
}

/** Validate command inputs and resolve them into a structured invocation without invoking a shell. */
export function resolveCommandInvocation(capability: CommandCapability, provided: CommandInputValues = {}): CommandInvocation {
  return resolveInvocation(capability, provided, false)
}

/** Resolve the same invocation with private input values removed for durable history. */
export function resolvePersistedCommandInvocation(capability: CommandCapability, provided: CommandInputValues = {}): CommandInvocation {
  return resolveInvocation(capability, provided, true)
}

/** Flatten prerequisite commands and their main command into execution order. */
export function commandInvocationSequence(invocation: CommandInvocation): CommandInvocation[] {
  const { prerequisites = [], ...command } = invocation
  return [
    ...prerequisites.flatMap(commandInvocationSequence),
    command,
  ]
}

function resolveInvocation(capability: CommandCapability, provided: CommandInputValues, redact: boolean): CommandInvocation {
  const definitions = capability.inputs ?? []
  const knownInputs = new Set(definitions.map(input => input.id))
  const unknown = Object.keys(provided).find(input => !knownInputs.has(input))
  if (unknown)
    throw new CommandInputValidationError(`Unknown input for ${capability.name}: ${unknown}`)

  const values = Object.fromEntries(definitions.map(input => [input.id, provided[input.id] ?? input.default ?? '']))
  validatePrerequisiteConditions(capability.invocation, knownInputs)
  const args = [...capability.invocation.args]
  const inputArgs: string[] = []

  for (const input of definitions) {
    if (!commandInputConditionMatches(input.visibleWhen, values))
      continue

    const value = values[input.id] ?? ''
    const required = input.required || (input.requiredWhen !== undefined && commandInputConditionMatches(input.requiredWhen, values))
    if (input.type === 'boolean') {
      if (value !== 'true' && value !== 'false')
        throw new CommandInputValidationError(`${input.label ?? input.id} must be true or false`)
      if (required && value !== 'true')
        throw new CommandInputValidationError(`${input.label ?? input.id} is required`)
      if (value === 'true' && !input.omitArgument) {
        if (!input.flag)
          throw new CommandInputValidationError(`${input.label ?? input.id} has no command flag`)
        inputArgs.push(input.flag)
      }
      continue
    }
    if (!value) {
      if (required)
        throw new CommandInputValidationError(`${input.label ?? input.id} is required`)
      continue
    }

    const selectedOption = input.type === 'select' ? input.options?.find(option => option.value === value) : undefined
    if (input.type === 'select' && !selectedOption)
      throw new CommandInputValidationError(`${input.label ?? input.id} must be one of: ${input.options?.map(option => option.value).join(', ') ?? ''}`)
    if (input.pattern && !new RegExp(input.pattern).test(value))
      throw new CommandInputValidationError(`${input.label ?? input.id} has an invalid value`)
    if (selectedOption?.omitArgument)
      continue
    if (selectedOption?.arguments) {
      inputArgs.push(...selectedOption.arguments)
      continue
    }

    const argumentValue = redact && (input.private || input.redactInHistory) ? '<redacted>' : value
    if (input.argumentStyle === 'positional')
      inputArgs.push(argumentValue)
    else if (!input.flag)
      throw new CommandInputValidationError(`${input.label ?? input.id} has no command flag`)
    else if (input.argumentStyle === 'separate')
      inputArgs.push(input.flag, argumentValue)
    else
      inputArgs.push(`${input.flag}=${argumentValue}`)
  }

  if (inputArgs.length && capability.inputArgSeparator)
    args.push(capability.inputArgSeparator)
  args.push(...inputArgs)

  return resolvePrerequisiteConditions({ ...capability.invocation, args }, values)
}

function validatePrerequisiteConditions(invocation: CommandInvocation, knownInputs: Set<string>): void {
  for (const prerequisite of invocation.prerequisites ?? []) {
    const conditions = prerequisite.when ? (Array.isArray(prerequisite.when) ? prerequisite.when : [prerequisite.when]) : []
    if (conditions.some(condition => !knownInputs.has(condition.input)))
      throw new CommandInputValidationError(`Prerequisite references an unknown condition input: ${conditions.find(condition => !knownInputs.has(condition.input))?.input}`)
    validatePrerequisiteConditions(prerequisite, knownInputs)
  }
}

function resolvePrerequisiteConditions(invocation: CommandInvocation, values: CommandInputValues): CommandInvocation {
  const { prerequisites = [], ...command } = invocation
  const resolvedPrerequisites = prerequisites
    .filter(prerequisite => commandInputConditionMatches(prerequisite.when, values))
    .map(({ when: _when, ...prerequisite }) => resolvePrerequisiteConditions(prerequisite, values))
  return {
    ...command,
    ...(resolvedPrerequisites.length ? { prerequisites: resolvedPrerequisites } : {}),
  }
}
