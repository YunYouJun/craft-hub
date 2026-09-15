import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Transactional, machine-local JSON snapshots. SQLite owns crash recovery and writer exclusion. */
export class DeliveryStore<T extends { version: number }> {
  private readonly database: DatabaseSync

  constructor(path: string, private readonly initial: () => T) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      chmodSync(dirname(path), 0o700)
    }
    this.database = new DatabaseSync(path)
    if (path !== ':memory:')
      chmodSync(path, 0o600)
    this.database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL)')
  }

  read(): T {
    const row = this.database.prepare('SELECT body FROM snapshot WHERE id = 1').get()
    if (!row)
      return this.initial()
    const data = JSON.parse(String(row.body)) as T
    if (data.version !== this.initial().version)
      throw new Error('Unsupported delivery store version')
    return data
  }

  /** The mutation is synchronous: no network operation may hold a database transaction. */
  transaction<R>(kind: string, mutate: (state: T) => R): R {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const state = this.read()
      const result = mutate(state)
      this.database.prepare('INSERT INTO snapshot VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body').run(JSON.stringify(state))
      this.database.prepare('INSERT INTO events(occurred_at, kind, body) VALUES(?, ?, ?)').run(Date.now(), kind, '{}')
      this.database.exec('COMMIT')
      return structuredClone(result)
    }
    catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.database.close()
  }
}
