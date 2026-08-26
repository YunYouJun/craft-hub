import type { CloudDocument } from '../src/types'
import { describe, expect, it } from 'vitest'
import { decideDocumentSync } from '../src/sync'

function document(revision: string, payload: unknown = revision): CloudDocument {
  return { key: 'settings/global', schemaVersion: 1, revision, payload }
}

describe('document sync', () => {
  it('covers unchanged, pull, push, and conflict decisions', () => {
    expect(decideDocumentSync('same', document('same'), document('same')).action).toBe('unchanged')
    expect(decideDocumentSync('base', document('base'), document('remote')).action).toBe('apply-remote')
    expect(decideDocumentSync('base', document('local'), document('base')).action).toBe('push-local')
    expect(decideDocumentSync('base', document('local'), document('remote'))).toMatchObject({
      action: 'conflict',
      conflict: { localRevision: 'local', remoteRevision: 'remote' },
    })
  })

  it('pushes a local document when the remote document does not exist', () => {
    expect(decideDocumentSync(undefined, document('local'), undefined)).toEqual({
      action: 'push-local',
      document: document('local'),
    })
  })
})
