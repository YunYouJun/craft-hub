import type { Capability, CommandCapability, CommandPackage } from 'craft-hub'

export type PackageSection = 'apps' | 'docs' | 'other' | 'packages' | 'root'

export interface PackageOverviewRow extends CommandPackage {
  capabilities: CommandCapability[]
}

export function packageSection(relativePath: string): PackageSection {
  if (relativePath === '.')
    return 'root'
  if (relativePath.startsWith('apps/'))
    return 'apps'
  if (relativePath.startsWith('packages/'))
    return 'packages'
  if (relativePath === 'docs' || relativePath.startsWith('docs/'))
    return 'docs'
  return 'other'
}

export function compareCompactPackages(left: CommandPackage, right: CommandPackage): number {
  if (left.root !== right.root)
    return left.root ? -1 : 1
  return left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true })
}

export function compareOverviewPackages(left: CommandPackage, right: CommandPackage): number {
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY
  if (leftOrder !== rightOrder)
    return leftOrder - rightOrder
  const sections: PackageSection[] = ['apps', 'other', 'packages', 'docs', 'root']
  const sectionDifference = sections.indexOf(packageSection(left.relativePath)) - sections.indexOf(packageSection(right.relativePath))
  if (sectionDifference)
    return sectionDifference
  return (left.name ?? left.relativePath).localeCompare(right.name ?? right.relativePath, undefined, { numeric: true })
}

export function packageOverviewRows(packages: CommandPackage[], capabilities: Capability[]): PackageOverviewRow[] {
  const rows = new Map<string, PackageOverviewRow>(packages.map(commandPackage => [
    commandPackage.relativePath,
    { ...commandPackage, capabilities: [] },
  ]))
  for (const capability of capabilities) {
    if (capability.kind !== 'command')
      continue
    const commandPackage = capability.package ?? { relativePath: '.', root: true }
    const row = rows.get(commandPackage.relativePath) ?? { ...commandPackage, capabilities: [] }
    row.name ??= commandPackage.name
    row.description ??= commandPackage.description
    row.capabilities.push(capability)
    rows.set(commandPackage.relativePath, row)
  }
  return [...rows.values()].sort(compareCompactPackages)
}
