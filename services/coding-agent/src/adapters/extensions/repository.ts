import { builtinTools } from '../../extensions/domain/builtin-tools.js'
import { digest } from './skill-files.js'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionRepository } from '../../extensions/application/ports.js'
import type {
  Binding,
  Catalog,
  Event,
  Inventory,
  Mutation,
  Operation,
  Server,
  Skill,
} from '../../extensions/domain/types.js'

/** The only writer of extension configuration. Revisions are retained conservatively. */
export class ExtensionsRepository implements ExtensionRepository {
  private db: DatabaseSync
  private listeners = new Set<() => void>()
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(join(directory, 'extensions.db'))
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version > 1) throw new Error('EXTENSION_DATABASE_TOO_NEW')
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS extension_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, epoch INTEGER NOT NULL);
      INSERT OR IGNORE INTO extension_meta VALUES(1,0,0);
      CREATE TABLE IF NOT EXISTS extension_objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS extension_mutations (id TEXT PRIMARY KEY, intent TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_revocations (epoch INTEGER PRIMARY KEY, targetId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_inventories (id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS extension_operations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);
      PRAGMA user_version=1;`)
    for (const row of this.db.prepare('SELECT value FROM extension_operations').all()) {
      const operation = JSON.parse(String(row.value)) as Operation
      if (operation.state === 'running')
        this.saveOperation({ ...operation, state: 'interrupted', errorCode: 'HOST_RESTARTED' })
    }
  }
  private meta(): { revision: number; epoch: number } {
    const row = this.db.prepare('SELECT revision,epoch FROM extension_meta WHERE id=1').get()!
    return { revision: Number(row.revision), epoch: Number(row.epoch) }
  }
  private values<T>(kind: string): T[] {
    return this.db
      .prepare('SELECT value FROM extension_objects WHERE kind=? ORDER BY id')
      .all(kind)
      .map((row) => JSON.parse(String(row.value)) as T)
  }
  catalog(): Catalog {
    const meta = this.meta()
    return {
      catalogRevision: meta.revision,
      policyEpoch: meta.epoch,
      builtinTools: builtinTools(digest),
      skills: this.values<Skill>('skill'),
      servers: this.values<Server>('server'),
      inventories: this.db
        .prepare('SELECT value FROM extension_inventories ORDER BY id,revision')
        .all()
        .map((row) => JSON.parse(String(row.value)) as Inventory),
    }
  }
  private get<T>(id: string, revision?: number): T {
    const row =
      revision === undefined
        ? this.db.prepare('SELECT value FROM extension_objects WHERE id=?').get(id)
        : this.db
            .prepare('SELECT value FROM extension_revisions WHERE id=? AND revision=?')
            .get(id, revision)
    if (!row) throw new Error('EXTENSION_NOT_FOUND')
    return JSON.parse(String(row.value)) as T
  }
  skill(id: string, revision?: number): Skill {
    const skill = this.get<Skill>(id, revision)
    if (!('files' in skill)) throw new Error('SKILL_NOT_FOUND')
    return skill
  }
  server(id: string, revision?: number): Server {
    const server = this.get<Server>(id, revision)
    if (!('transport' in server)) throw new Error('MCP_SERVER_NOT_FOUND')
    return server
  }
  binding(id: string): Binding | undefined {
    const row = this.db
      .prepare("SELECT value FROM extension_objects WHERE id=? AND kind='binding'")
      .get(id)
    return row ? (JSON.parse(String(row.value)) as Binding) : undefined
  }
  inventory(id: string, revision: number): Inventory {
    const row = this.db
      .prepare('SELECT value FROM extension_inventories WHERE id=? AND revision=?')
      .get(id, revision)
    if (!row) throw new Error('MCP_INVENTORY_REQUIRED')
    return JSON.parse(String(row.value)) as Inventory
  }
  mutation(id: string, intent?: string): Mutation | null {
    const row = this.db.prepare('SELECT intent,result FROM extension_mutations WHERE id=?').get(id)
    if (!row) return null
    if (intent !== undefined && row.intent !== intent) throw new Error('IDEMPOTENCY_CONFLICT')
    return JSON.parse(String(row.result)) as Mutation
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.db.exec('COMMIT')
      this.notify()
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private event(type: Event['type'], targetId: string): void {
    const meta = this.meta()
    this.db
      .prepare('INSERT INTO extension_events(value) VALUES(?)')
      .run(
        JSON.stringify({ type, targetId, catalogRevision: meta.revision, policyEpoch: meta.epoch }),
      )
  }
  private receipt(
    mutationId: string,
    intent: string,
    targetId: string,
    revision: number,
  ): Mutation {
    const result = { mutationId, targetId, revision }
    this.db
      .prepare('INSERT INTO extension_mutations VALUES(?,?,?)')
      .run(mutationId, intent, JSON.stringify(result))
    return result
  }
  commit(input: Parameters<ExtensionRepository['commit']>[0]): Mutation {
    return this.transaction(() => {
      const prior = this.mutation(input.mutationId, input.intent)
      if (prior) return prior
      const current = this.db
        .prepare('SELECT revision,kind FROM extension_objects WHERE id=?')
        .get(input.targetId)
      if (
        Number(current?.revision ?? 0) !== input.expectedRevision ||
        (current && current.kind !== input.kind)
      )
        throw new Error('EXTENSION_REVISION_CONFLICT')
      const revision = input.expectedRevision + 1,
        value = JSON.stringify({ ...input.value, revision })
      this.db
        .prepare('INSERT INTO extension_revisions VALUES(?,?,?)')
        .run(input.targetId, revision, value)
      this.db
        .prepare(
          'INSERT INTO extension_objects VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value',
        )
        .run(input.targetId, input.kind, revision, value)
      this.db.exec('UPDATE extension_meta SET revision=revision+1 WHERE id=1')
      this.event(input.event, input.targetId)
      return this.receipt(input.mutationId, input.intent, input.targetId, revision)
    })
  }
  revoke(mutationId: string, intent: string, targetId: string): Mutation {
    return this.transaction(() => {
      const prior = this.mutation(mutationId, intent)
      if (prior) return prior
      this.get<unknown>(targetId)
      this.db.exec('UPDATE extension_meta SET epoch=epoch+1,revision=revision+1 WHERE id=1')
      const epoch = this.meta().epoch
      this.db.prepare('INSERT INTO extension_revocations VALUES(?,?)').run(epoch, targetId)
      this.event('capability.revoked', targetId)
      return this.receipt(mutationId, intent, targetId, epoch)
    })
  }
  revoked(id: string, since: number): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM extension_revocations WHERE targetId=? AND epoch>? LIMIT 1')
      .get(id, since)
  }
  saveInventory(inventory: Inventory): void {
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO extension_inventories VALUES(?,?,?) ON CONFLICT(id,revision) DO UPDATE SET value=excluded.value',
        )
        .run(inventory.serverId, inventory.configRevision, JSON.stringify(inventory))
      this.db.exec('UPDATE extension_meta SET revision=revision+1 WHERE id=1')
      this.event('mcp.inventory_changed', inventory.serverId)
    })
  }
  operation(id: string): Operation {
    const row = this.db.prepare('SELECT value FROM extension_operations WHERE id=?').get(id)
    if (!row) throw new Error('EXTENSION_OPERATION_NOT_FOUND')
    return JSON.parse(String(row.value)) as Operation
  }
  saveOperation(operation: Operation): void {
    this.db
      .prepare(
        'INSERT INTO extension_operations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(operation.id, JSON.stringify(operation))
  }
  events(after: number): { events: Event[]; watermark: number } {
    const rows = this.db
      .prepare('SELECT seq,value FROM extension_events WHERE seq>? ORDER BY seq LIMIT 200')
      .all(after)
    return {
      events: rows.map((row) => ({
        ...(JSON.parse(String(row.value)) as Event),
        seq: Number(row.seq),
      })),
      watermark: Number(
        this.db.prepare('SELECT MAX(seq) AS seq FROM extension_events').get()?.seq ?? 0,
      ),
    }
  }
  wait(after: number): Promise<ReturnType<ExtensionsRepository['events']>> {
    if (this.events(after).events.length) return Promise.resolve(this.events(after))
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        this.listeners.delete(finish)
        resolve(this.events(after))
      }
      const timer = setTimeout(finish, 20000)
      this.listeners.add(finish)
    })
  }
  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
  exportDatabase(path: string): void {
    this.db.prepare('VACUUM INTO ?').run(path)
  }
  close(): void {
    this.notify()
    this.db.close()
  }
}
