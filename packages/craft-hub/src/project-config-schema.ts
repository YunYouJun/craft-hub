import { z } from 'zod'
import { projectAccentColors } from './types'

/** Stable public identity for the version 1 project configuration schema. */
export const projectConfigSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json' as const

const localizedTextSchema = z.union([
  z.string().min(1),
  z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
])

const inputConditionSchema = z.strictObject({
  input: z.string().min(1),
  equals: z.string(),
})

const inputOptionBaseShape = {
  value: z.string().min(1),
  label: localizedTextSchema.optional(),
}

const inputOptionSchema = z.union([
  z.string().min(1),
  z.strictObject({
    ...inputOptionBaseShape,
    omitArgument: z.boolean().optional(),
  }),
])

const skillInputOptionSchema = z.union([
  z.string().min(1),
  z.strictObject(inputOptionBaseShape),
])

const capabilityInputBaseShape = {
  label: localizedTextSchema.optional(),
  description: localizedTextSchema.optional(),
  default: z.string().optional(),
  required: z.boolean().optional(),
  requiredWhen: inputConditionSchema.optional(),
  visibleWhen: inputConditionSchema.optional(),
}

const commandInputBaseShape = {
  ...capabilityInputBaseShape,
  flag: z.string().regex(/^-\S*$/, 'Flags must start with a hyphen and contain no whitespace'),
  argumentStyle: z.enum(['equals', 'separate']).optional(),
}

const projectCommandInputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commandInputBaseShape,
    type: z.literal('select'),
    options: z.array(inputOptionSchema).min(1),
    pattern: z.string().optional(),
  }),
  z.strictObject({
    ...commandInputBaseShape,
    type: z.literal('text'),
    options: z.never().optional(),
    pattern: z.string().optional(),
  }),
])

const projectSkillInputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...capabilityInputBaseShape,
    type: z.literal('select'),
    options: z.array(skillInputOptionSchema).min(1),
    pattern: z.string().optional(),
  }),
  z.strictObject({
    ...capabilityInputBaseShape,
    type: z.literal('text'),
    options: z.never().optional(),
    pattern: z.string().optional(),
  }),
])

/** Runtime validator and single source of truth for project.jsonc. */
export const projectConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  project: z.strictObject({
    name: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
    color: z.enum(projectAccentColors).optional(),
  }).optional(),
  defaults: z.strictObject({
    agent: z.string().min(1).optional(),
  }).optional(),
  capabilities: z.strictObject({
    hidden: z.array(z.string().min(1)).optional(),
    descriptions: z.record(z.string(), localizedTextSchema).optional(),
    inputs: z.record(z.string(), z.record(z.string(), projectCommandInputSchema)).optional(),
    skillInputs: z.record(z.string(), z.record(z.string(), projectSkillInputSchema)).optional(),
  }).optional(),
  packages: z.record(z.string(), z.strictObject({
    description: localizedTextSchema.optional(),
  })).optional(),
  extensions: z.record(z.string().min(1), z.unknown()).optional(),
})

/** Text with either a default value or locale-specific translations. */
export type LocalizedText = z.infer<typeof localizedTextSchema>

/** One selectable value accepted by a configured command input. */
export type ProjectCommandInputOptionConfig = z.infer<typeof inputOptionSchema>

/** Declarative input metadata used to build a safe command invocation. */
export type ProjectCommandInputConfig = z.infer<typeof projectCommandInputSchema>

/** Declarative input metadata rendered for an agent skill invocation. */
export type ProjectSkillInputConfig = z.infer<typeof projectSkillInputSchema>

/** Validated version 1 project.jsonc contents. */
export type ProjectConfig = z.infer<typeof projectConfigSchema>

/** Generate the public Draft 2020-12 schema shipped with Craft Hub. */
export function projectConfigJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(projectConfigSchema, { target: 'draft-2020-12' }) as Record<string, unknown>
  return {
    ...generated,
    $id: projectConfigSchemaUrl,
    title: 'Craft Hub project configuration',
    description: 'Repository-owned metadata for Craft Hub project discovery and presentation.',
  }
}
