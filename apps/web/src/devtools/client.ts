import type { DevframeRpcClient } from 'devframe/client'
import type { InspectorReader } from '../../devtools/types'
import { connectDevframe } from 'devframe/client'

let connection: Promise<DevframeRpcClient> | undefined

function connect(): Promise<DevframeRpcClient> {
  connection ??= connectDevframe({ callTimeout: 10_000 }).catch((error) => {
    connection = undefined
    throw error
  })
  return connection
}

export const inspector: InspectorReader = {
  snapshot: async () => (await connect()).call('craft-hub:snapshot'),
  discover: async projectId => (await connect()).call('craft-hub:discover', projectId),
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void connection?.then(client => client.close?.()).catch(() => {})
  })
}
