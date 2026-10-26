import type { ParseResult } from '@babel/parser'
import type { SoftwareCatalogManifest } from './software-catalog'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import { z } from 'zod'
import { softwareCatalogManifestSchema, softwareMetadataSchema } from './software-catalog'

type Statement = ParseResult['program']['body'][number]
type Expression = Extract<Statement, { type: 'ExpressionStatement' }>['expression']
type ObjectProperty = Extract<Extract<Expression, { type: 'ObjectExpression' }>['properties'][number], { type: 'ObjectProperty' }>
type Value = Expression | ObjectProperty['value']

/** Identity of the default, independently bundled catalog. */
export const workstationCatalogSource = { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation' } as const

const itemSchema = z.object({
  id: softwareMetadataSchema.shape.id,
  name: softwareMetadataSchema.shape.title,
  url: softwareMetadataSchema.shape.url,
  downloadUrl: softwareMetadataSchema.shape.downloadUrl,
  repositoryUrl: softwareMetadataSchema.shape.repositoryUrl,
  iconUrl: softwareMetadataSchema.shape.iconUrl,
  macosIconUrl: softwareMetadataSchema.shape.macosIconUrl,
  iconStyle: softwareMetadataSchema.shape.iconStyle,
  iconScale: softwareMetadataSchema.shape.iconScale,
  favicon: softwareMetadataSchema.shape.iconUrl,
  note: softwareMetadataSchema.shape.description,
  platforms: softwareMetadataSchema.shape.platforms,
  macosBundleId: softwareMetadataSchema.shape.macosBundleId,
  uninstallUrl: softwareMetadataSchema.shape.uninstallUrl,
  cask: z.string().max(256).optional(),
  formula: z.string().max(256).optional(),
})
const groupsSchema = z.array(z.object({
  id: softwareMetadataSchema.shape.group.shape.id,
  label: softwareMetadataSchema.shape.title,
  items: z.array(itemSchema).max(1000),
})).min(1).max(100).refine(groups => new Set(groups.map(group => group.id)).size === groups.length, 'Group identifiers must be unique')

// The AST is treated as data: unsupported nodes are rejected, never evaluated.
function literal(expression: Value | null | undefined, depth = 0): unknown {
  if (!expression || depth > 30)
    throw new Error('Software config must contain bounded literal data')
  switch (expression.type) {
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
    case 'ParenthesizedExpression':
      return literal(expression.expression, depth + 1)
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'NumericLiteral':
      return expression.value
    case 'NullLiteral':
      return null
    case 'ArrayExpression':
      return expression.elements.map((element) => {
        if (element?.type === 'SpreadElement')
          throw new Error('Software config does not support spreads')
        return literal(element, depth + 1)
      })
    case 'ObjectExpression': {
      const result: Record<string, unknown> = Object.create(null)
      for (const property of expression.properties) {
        if (property.type !== 'ObjectProperty' || property.computed || property.shorthand || (property.key.type !== 'Identifier' && property.key.type !== 'StringLiteral'))
          throw new Error('Software config only supports literal object properties')
        const key = property.key.type === 'Identifier' ? property.key.name : property.key.value
        if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key))
          throw new Error('Software config contains an unsafe or duplicate key')
        result[key] = literal(property.value, depth + 1)
      }
      return result
    }
    default:
      throw new Error('Software config only supports literal data, without references, calls or spreads')
  }
}

/** Statically read exported softwareGroups; imports, functions and other module statements never run. */
export function parseSoftwareConfig(content: string, source: SoftwareCatalogManifest['source']): SoftwareCatalogManifest {
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024)
    throw new Error('Software config exceeds the size limit')
  const ast = parse(content, { sourceType: 'module', plugins: ['typescript'] })
  const declarations = ast.program.body.flatMap(statement => statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'VariableDeclaration' && statement.declaration.kind === 'const'
    ? statement.declaration.declarations.filter(declaration => declaration.id.type === 'Identifier' && declaration.id.name === 'softwareGroups')
    : [])
  if (declarations.length !== 1)
    throw new Error('Expected export const softwareGroups with a literal array')
  const groups = groupsSchema.parse(literal(declarations[0]!.init))
  const items = groups.flatMap(group => group.items.map((item) => {
    const packageId = item.cask ?? item.formula
    return softwareMetadataSchema.parse({
      id: item.id,
      title: item.name,
      group: { id: group.id, title: group.label },
      url: item.url,
      ...(item.downloadUrl ? { downloadUrl: item.downloadUrl } : {}),
      ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
      ...(item.iconUrl || item.favicon ? { iconUrl: item.iconUrl ?? item.favicon } : {}),
      ...(item.macosIconUrl ? { macosIconUrl: item.macosIconUrl } : {}),
      ...(item.iconStyle ? { iconStyle: item.iconStyle } : {}),
      ...(item.iconScale !== undefined ? { iconScale: item.iconScale } : {}),
      ...(item.note ? { description: item.note } : {}),
      ...(item.platforms ? { platforms: item.platforms } : {}),
      ...(item.macosBundleId ? { macosBundleId: item.macosBundleId } : {}),
      ...(item.uninstallUrl ? { uninstallUrl: item.uninstallUrl } : {}),
      installation: packageId && /^(?:[a-z0-9][a-z0-9._+-]*\/){0,2}[a-z0-9][a-z0-9._+-]*$/.test(packageId)
        ? { kind: item.cask ? 'brew-cask' : 'brew-formula', packageId }
        : { kind: item.downloadUrl ? 'download' : 'manual' },
    })
  }))
  const body = softwareCatalogManifestSchema.omit({ revision: true }).parse({ version: 1, source, items })
  return { ...body, revision: createHash('sha256').update(JSON.stringify(body)).digest('hex') }
}
