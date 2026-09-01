import type { CommandCapability, CommandInputValues } from 'craft-hub'

function storageKey(projectId: string, capabilityId: string): string {
  return `craft-hub-command-inputs:${projectId}:${capabilityId}`
}

function rememberedSelectInputs(capability: CommandCapability): NonNullable<CommandCapability['inputs']> {
  return (capability.inputs ?? []).filter(input => input.type === 'select' && !input.private && !input.redactInHistory)
}

/** Resolve command form values from declared defaults, then valid user history. */
export function commandInputInitialValues(projectId: string, capability: CommandCapability, storage: Storage): CommandInputValues {
  const values = Object.fromEntries((capability.inputs ?? []).map(input => [input.id, input.default ?? '']))
  try {
    const stored = JSON.parse(storage.getItem(storageKey(projectId, capability.id)) ?? '{}') as Record<string, unknown>
    for (const input of rememberedSelectInputs(capability)) {
      const value = stored[input.id]
      if (typeof value === 'string' && input.options?.some(option => option.value === value))
        values[input.id] = value
    }
  }
  catch {}
  return values
}

/** Remember only submitted, non-private select values that remain valid options. */
export function rememberCommandInputValues(projectId: string, capability: CommandCapability, values: CommandInputValues, storage: Storage): void {
  const remembered = Object.fromEntries(rememberedSelectInputs(capability).flatMap((input) => {
    const value = values[input.id]
    return value !== undefined && input.options?.some(option => option.value === value) ? [[input.id, value]] : []
  }))
  storage.setItem(storageKey(projectId, capability.id), JSON.stringify(remembered))
}
