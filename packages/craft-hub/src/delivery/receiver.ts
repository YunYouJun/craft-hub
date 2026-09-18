import type { DeliveryDevice, DeliveryRequest, DeliveryRequestStatus } from './types'
import { DeliveryStore } from './store'

export interface DeliveryLocalTask { id: string, status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_attention', summary?: string }
/** Implemented by a local host; project resolution and trust must happen here. */
export interface DeliveryLocalExecutor {
  capabilities: DeliveryDevice['capabilities']
  start: (request: DeliveryRequest) => Promise<DeliveryLocalTask>
  find: (requestId: string) => Promise<DeliveryLocalTask | undefined>
  get: (taskId: string) => Promise<DeliveryLocalTask | undefined>
  cancel: (taskId: string) => Promise<void>
}
/** Authenticated outbound connection. No remote caller supplies a local filesystem path. */
export interface DeliveryReceiverTransport {
  poll: (capabilities: DeliveryDevice['capabilities']) => Promise<DeliveryRequest[]>
  report: (input: { id: string, sequence: number, status: DeliveryRequestStatus, localTaskId?: string, summary?: string }) => Promise<DeliveryRequest>
}
interface ReceiverState {
  version: 1
  attempts: Record<string, { localTaskId?: string, status: 'prepared' | 'attached', sequence: number }>
}

/** Crash-aware local receiver. Unknown starts are reconciled, never silently started twice. */
export class DeliveryReceiver {
  private readonly journal: DeliveryStore<ReceiverState>
  private ticking = false

  constructor(path: string, private readonly transport: DeliveryReceiverTransport, private readonly executor: DeliveryLocalExecutor) {
    this.journal = new DeliveryStore(path, () => ({ version: 1, attempts: {} }))
  }

  async tick(): Promise<void> {
    if (this.ticking)
      return
    this.ticking = true
    try {
      for (const request of await this.transport.poll(this.executor.capabilities))
        await this.handle(request)
    }
    finally {
      this.ticking = false
    }
  }

  private async handle(request: DeliveryRequest): Promise<void> {
    let record = this.journal.read().attempts[request.id]
    if (!record) {
      if (request.status !== 'dispatched') {
        await this.report(request, 'needs_attention', undefined, 'Local request journal is missing; inspect the original device')
        return
      }
      const claimed = this.journal.transaction('receiver.prepare', (state) => {
        if (state.attempts[request.id])
          return false
        state.attempts[request.id] = { status: 'prepared', sequence: request.reportSequence }
        return true
      })
      if (!claimed)
        return
      // Acknowledgement precedes execution, so a lost acknowledgement cannot start code.
      const acknowledged = await this.report(request, 'starting')
      if (acknowledged.status !== 'starting')
        return
      let task: DeliveryLocalTask
      try {
        task = await this.executor.start(request)
      }
      catch {
        await this.report(request, 'needs_attention', undefined, 'Local start needs inspection; it will not be repeated automatically')
        return
      }
      this.attach(request.id, task.id)
      record = this.journal.read().attempts[request.id]
    }
    let task = record.localTaskId ? await this.executor.get(record.localTaskId) : await this.executor.find(request.id)
    if (!task) {
      await this.report(request, 'needs_attention', undefined, 'Local task state is unavailable; inspect before retrying')
      return
    }
    if (!record.localTaskId)
      this.attach(request.id, task.id)
    if (request.status === 'cancel_requested' && task.status === 'running') {
      await this.executor.cancel(task.id)
      task = await this.executor.get(task.id) ?? task
    }
    // Terminal output only; the receiver does not upload the agent transcript.
    await this.report(request, task.status, task.id, task.status === 'running' ? undefined : task.summary?.slice(0, 8000))
  }

  private attach(requestId: string, localTaskId: string): void {
    this.journal.transaction('receiver.attach', (state) => {
      state.attempts[requestId].localTaskId = localTaskId
      state.attempts[requestId].status = 'attached'
    })
  }

  private async report(request: DeliveryRequest, status: DeliveryRequestStatus, localTaskId?: string, summary?: string): Promise<DeliveryRequest> {
    const sequence = this.journal.transaction('receiver.sequence', (state) => {
      const attempt = state.attempts[request.id] ??= { status: 'prepared', sequence: request.reportSequence }
      attempt.sequence = Math.max(attempt.sequence, request.reportSequence) + 1
      return attempt.sequence
    })
    return this.transport.report({ id: request.id, sequence, status, ...(localTaskId ? { localTaskId } : {}), ...(summary ? { summary } : {}) })
  }

  close(): void {
    this.journal.close()
  }
}
