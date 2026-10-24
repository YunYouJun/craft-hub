import type { CraftHubRuntime, ProjectRecord, ProjectReference } from 'craft-hub'
import type { DesktopLink, DesktopNavigationRequest } from './deep-links.ts'
import { nativeCandidateDesktopScheme, parseDesktopLink, productionDesktopScheme } from './deep-links.ts'

export type NativeDesktopLink = Exclude<DesktopLink, { kind: 'navigation' | 'cloud-connect' }> | {
  kind: 'navigation'
  navigation: Exclude<DesktopNavigationRequest, { kind: 'project' }> | (Extract<DesktopNavigationRequest, { kind: 'project' }> & { matches: ProjectRecord[] })
}

/** Host services used by the bootstrapped workbench without granting execution or trust. */
export interface NativeNavigationService {
  resolve: (raw: unknown) => Promise<NativeDesktopLink>
  verify: (reference: unknown, path: unknown) => Promise<boolean>
}

/** Read-only desktop link resolution; registering a missing project still requires the workbench dialog. */
export function createNativeNavigationService(getRuntime: () => Pick<CraftHubRuntime, 'projects'>): NativeNavigationService {
  return {
    async resolve(raw: unknown) {
      if (typeof raw !== 'string')
        throw new TypeError('A Desktop Link is required')
      const link = parseDesktopLink(raw, [nativeCandidateDesktopScheme, productionDesktopScheme])
      if (link.kind === 'cloud-connect')
        throw new Error('Personal cloud callbacks are not available in this native candidate')
      if (link.kind !== 'navigation')
        return link
      if (link.navigation.kind !== 'project')
        return { kind: 'navigation', navigation: link.navigation }
      return {
        ...link,
        navigation: { ...link.navigation, matches: await getRuntime().projects.resolveReference(link.navigation.reference) },
      }
    },
    async verify(reference: unknown, path: unknown): Promise<boolean> {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference) || typeof path !== 'string')
        throw new TypeError('Project Reference and local directory are required')
      const value = reference as Record<string, unknown>
      if (typeof value.repository !== 'string' || (value.subdir !== undefined && typeof value.subdir !== 'string'))
        throw new TypeError('Invalid Project Reference')
      await getRuntime().projects.verifyReference(path, value as unknown as ProjectReference)
      return true
    },
  }
}
