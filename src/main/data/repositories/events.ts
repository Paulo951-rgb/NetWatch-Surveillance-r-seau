import type { EventCategory, HistoryEvent, HistoryQuery } from '@shared/types'
import type { SqliteDatabase } from '../database'

interface EventRow {
  id: number
  category: string
  type: string
  message: string
  device_id: number | null
  device_name: string | null
  created_at: number
  meta: string | null
}

export interface EventInput {
  category: EventCategory
  type: string
  message: string
  deviceId?: number | null
  createdAt: number
  meta?: Record<string, unknown> | null
}

function rowToEvent(row: EventRow): HistoryEvent {
  let meta: Record<string, unknown> | null = null
  if (row.meta) {
    try {
      const parsed = JSON.parse(row.meta)
      if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>
    } catch {
      meta = null
    }
  }
  return {
    id: row.id,
    category: row.category as EventCategory,
    type: row.type,
    message: row.message,
    deviceId: row.device_id,
    deviceName: row.device_name,
    createdAt: row.created_at,
    meta
  }
}

const SELECT_BASE = `
  SELECT e.id, e.category, e.type, e.message, e.device_id, e.created_at, e.meta,
         COALESCE(d.custom_name, d.hostname, d.ip) AS device_name
  FROM events e
  LEFT JOIN devices d ON d.id = e.device_id
`

export class EventRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: EventInput): HistoryEvent {
    const info = this.db
      .prepare(
        'INSERT INTO events (category, type, message, device_id, created_at, meta) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        input.category,
        input.type,
        input.message,
        input.deviceId ?? null,
        input.createdAt,
        input.meta ? JSON.stringify(input.meta) : null
      )
    const row = this.db.prepare(`${SELECT_BASE} WHERE e.id = ?`).get(Number(info.lastInsertRowid)) as
      | EventRow
      | undefined
    if (!row) throw new Error("Échec de l'insertion de l'événement")
    return rowToEvent(row)
  }

  list(query: HistoryQuery = {}): HistoryEvent[] {
    const { where, params } = this.buildWhere(query)
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 5000)
    const offset = Math.max(query.offset ?? 0, 0)
    const rows = this.db
      .prepare(`${SELECT_BASE} ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as EventRow[]
    return rows.map(rowToEvent)
  }

  count(query: HistoryQuery = {}): number {
    const { where, params } = this.buildWhere(query)
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM events e ${where}`).get(...params) as {
      count: number
    }
    return row.count
  }

  private buildWhere(query: HistoryQuery): { where: string; params: unknown[] } {
    const clauses: string[] = []
    const params: unknown[] = []
    if (query.from) {
      clauses.push('e.created_at >= ?')
      params.push(query.from)
    }
    if (query.to) {
      clauses.push('e.created_at <= ?')
      params.push(query.to)
    }
    if (query.categories && query.categories.length > 0) {
      clauses.push(`e.category IN (${query.categories.map(() => '?').join(', ')})`)
      params.push(...query.categories)
    }
    if (query.search && query.search.trim()) {
      clauses.push('(LOWER(e.message) LIKE ? OR LOWER(e.type) LIKE ?)')
      const term = `%${query.search.trim().toLowerCase()}%`
      params.push(term, term)
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
  }

  deleteOlderThan(timestamp: number): number {
    const info = this.db.prepare('DELETE FROM events WHERE created_at < ?').run(timestamp)
    return info.changes
  }

  clearAll(): void {
    this.db.exec('DELETE FROM events;')
  }
}
