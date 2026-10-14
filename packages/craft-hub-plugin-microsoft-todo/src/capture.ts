import type { IntegrationEntity } from 'craft-hub'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MicrosoftTodoError } from './transport'

export interface TodoCapture {
  requestId: string
  accountId: string
  listId: string
  title: string
  notes: string
  important: boolean
  dueDate?: string
  reminderAt?: string
}

/** Validate reviewed task fields; no arbitrary Graph payload is forwarded. */
export function todoCapture(input: Record<string, unknown>): TodoCapture {
  const { requestId, accountId, listId, title, notes = '', important = false, dueDate, reminderAt } = input
  if (typeof requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(requestId)
    || typeof accountId !== 'string' || !accountId || typeof listId !== 'string' || !listId || listId.length > 1024
    || typeof title !== 'string' || !title.trim() || title.length > 500
    || typeof notes !== 'string' || notes.length > 10000 || typeof important !== 'boolean'
    || (dueDate !== undefined && (typeof dueDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate))
    || (reminderAt !== undefined && (typeof reminderAt !== 'string' || !dueDate || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(reminderAt) || !Number.isFinite(Date.parse(reminderAt)) || new Date(reminderAt).toISOString() !== reminderAt))) {
    throw new Error('Invalid task capture. Review the title, list and date.')
  }
  return { requestId, accountId, listId, title: title.trim(), notes: notes.trim(), important, ...(typeof dueDate === 'string' ? { dueDate } : {}), ...(typeof reminderAt === 'string' ? { reminderAt } : {}) }
}

/** Persist attempts before writing so timeouts and host restarts never silently duplicate a task. */
export async function createCapturedTodo(directory: string, input: TodoCapture, create: () => Promise<IntegrationEntity>): Promise<IntegrationEntity> {
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${input.requestId}.json`)
  try {
    const saved = JSON.parse(await readFile(path, 'utf8')) as { fingerprint: string, item?: IntegrationEntity }
    if (saved.fingerprint !== fingerprint)
      throw new Error('This capture request belongs to different task fields.')
    if (saved.item)
      return saved.item
    throw new Error('Task creation could not be confirmed. Check Microsoft To Do before recording it again.')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  await writeFile(path, JSON.stringify({ fingerprint }), { flag: 'wx', mode: 0o600 })
  try {
    const item = await create()
    await writeFile(path, JSON.stringify({ fingerprint, item }), { mode: 0o600 })
    return item
  }
  catch (error) {
    if (error instanceof MicrosoftTodoError && error.kind === 'authorization') {
      // Authorization failures occur before Graph accepts the write; this intent can be retried after consent.
      const { rm } = await import('node:fs/promises')
      await rm(path, { force: true })
      throw error
    }
    throw new Error('Task creation could not be confirmed. Check Microsoft To Do before recording it again.')
  }
}
