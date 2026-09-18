import type { CraftHubRuntime } from '../runtime'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { createDeliveryReceiverTransport } from './http'
import { createDeliveryLocalExecutor } from './local-executor'
import { DeliveryReceiver } from './receiver'
import { DeliveryError, deliveryId } from './types'

const configuration = z.object({ origin: z.string().url(), id: deliveryId, token: z.string().regex(/^[a-f0-9]{64}$/), bindings: z.record(deliveryId, deliveryId) }).strict()

/** Pair a receiver with a browser-confirmed account. The verifier and credential never enter the URL. */
export async function pairDeliveryDevice(input: { origin: string, name: string, bindings: Record<string, string>, credentialPath: string, onPairing: (id: string) => void, signal?: AbortSignal }): Promise<void> {
  const proof = randomBytes(32).toString('hex')
  // Validate the destination using the same rules as the authenticated receiver transport.
  createDeliveryReceiverTransport(input.origin, { id: 'validation', token: '' })
  const request = async (path: string, body: unknown): Promise<Response> => fetch(new URL(`/api/delivery/${path}`, input.origin), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), body: JSON.stringify(body) })
  const response = await request('pairings', { name: input.name, verifierHash: createHash('sha256').update(proof).digest('hex') })
  if (!response.ok)
    throw new DeliveryError(response.status, 'Could not begin device pairing')
  const pairing = z.object({ id: deliveryId, expiresAt: z.number() }).parse(await response.json())
  input.onPairing(pairing.id)
  while (Date.now() < pairing.expiresAt) {
    input.signal?.throwIfAborted()
    const result = await request('pairings/redeem', { id: pairing.id, verifier: proof })
    if (result.status === 409) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      continue
    }
    if (!result.ok)
      throw new DeliveryError(result.status, 'Pairing was rejected or expired')
    const device = z.object({ id: deliveryId, token: z.string() }).parse(await result.json())
    const config = configuration.parse({ origin: input.origin, ...device, bindings: input.bindings })
    await mkdir(dirname(input.credentialPath), { recursive: true, mode: 0o700 })
    const temporary = `${input.credentialPath}.${randomBytes(8).toString('hex')}.tmp`
    await writeFile(temporary, JSON.stringify(config), { mode: 0o600 })
    await rename(temporary, input.credentialPath)
    await chmod(input.credentialPath, 0o600)
    return
  }
  throw new DeliveryError(408, 'Device pairing expired')
}

/** Start an explicitly configured local receiver; hosted configuration accounts cannot execute. */
export async function startDeliveryConnection(runtime: CraftHubRuntime, credentialPath: string): Promise<() => Promise<void>> {
  if (runtime.hostEnvironment.kind !== 'local' || !runtime.agentTasks.availability().available)
    throw new DeliveryError(409, 'A local host with an agent executor is required')
  const config = configuration.parse(JSON.parse(await readFile(credentialPath, 'utf8')))
  for (const id of Object.values(config.bindings)) {
    const project = await runtime.projects.get(id)
    if (project.trust !== 'trusted')
      throw new DeliveryError(403, 'Trust each bound project locally before enabling the receiver')
  }
  const receiver = new DeliveryReceiver(join(runtime.store.dataDir, 'delivery-receiver', `${createHash('sha256').update(config.id).digest('hex')}.sqlite`), createDeliveryReceiverTransport(config.origin, config), createDeliveryLocalExecutor(runtime, config.bindings))
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()
  const schedule = (): void => {
    if (stopped)
      return
    pending = receiver.tick().catch((error) => {
      if (error instanceof DeliveryError && error.status === 401)
        stopped = true
    }).finally(() => {
      if (!stopped)
        timer = setTimeout(schedule, 3000)
    })
  }
  schedule()
  return async () => {
    stopped = true
    clearTimeout(timer)
    await pending
    receiver.close()
  }
}
