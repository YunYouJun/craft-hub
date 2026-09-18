import type { CapabilityDiscoveryResult, ProjectCatalogSnapshot, RunRecord, RuntimeHealth, WorkbenchDiagnosticSnapshot } from 'craft-hub'
import type {} from 'devframe/types'

export type InspectorRun = Pick<RunRecord, 'id' | 'projectId' | 'capabilityId' | 'command' | 'args' | 'cwd' | 'startedAt' | 'finishedAt' | 'exitCode' | 'status'>

export interface InspectorSnapshot {
  checkedAt: string
  health?: RuntimeHealth
  catalog: ProjectCatalogSnapshot
  diagnostics?: WorkbenchDiagnosticSnapshot
  runs: InspectorRun[]
  errors: Array<{ section: string, message: string }>
}

export interface InspectorReader {
  snapshot: () => Promise<InspectorSnapshot>
  discover: (projectId: string) => Promise<CapabilityDiscoveryResult>
}

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    'craft-hub:snapshot': InspectorReader['snapshot']
    'craft-hub:discover': InspectorReader['discover']
  }
}
