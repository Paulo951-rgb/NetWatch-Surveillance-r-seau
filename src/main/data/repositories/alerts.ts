import type { Alert, AlertSeverity, AlertType } from '@shared/types'
import type { SqliteDatabase } from '../database'

interface AlertRow {
  id: number
  type: string
  severity: string
  title: string
  message: string
  device_id: number | null
  device_name: string | null
  created_at: number
  read: number
}

export interface AlertInput {
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  deviceId?: number | null
  createdAt: number
  rule?: string | null
}

export interface AlertFilter {
  limit?: number
  offset?: number
  severity?: AlertSeverity | 'all'
  unreadOnly?: boolean
  type?: AlertType | 'all'
  from?: number
  to?: number
}

function rowToAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    type: row.type as AlertType,
    severity: row.severity as AlertSeverity,
    title: row.title,
    message: row.message,
    deviceId: row.device_id,
    deviceName: row.device_name,
    createdAt: row.created_at,
    read: row.read === 1
  }
}

const SELECT_BASE = `
  SELECT a.id, a.type, a.severity, a.title, a.message, a.device_id, a.created_at, a.read,
         COALESCE(d.custom_name, d.hostname, d.ip) AS device_name
  FROM alerts a
  LEFT JOIN devices d ON d.id = a.device_id
`

export class AlertRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: AlertInput): Alert {
    const info = this.db
      .prepare(
        `INSERT INTO alerts (type, severity, title, message, device_id, created_at, read, rule)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        input.type,
        input.severity,
        input.title,
        input.message,
        input.deviceId ?? null,
        input.createdAt,
        input.rule ?? null
      )
    const alert = this.get(Number(info.lastInsertRowid))
    if (!alert) throw new Error("Échec de l'insertion de l'alerte")
    return alert
  }

  get(id: number): Alert | null {
    const row = this.db.prepare(`${SELECT_BASE} WHERE a.id = ?`).get(id) as AlertRow | undefined
    return row ? rowToAlert(row) : null
  }

  list(filter: AlertFilter = {}): Alert[] {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.severity && filter.severity !== 'all') {
      clauses.push('a.severity = ?')
      params.push(filter.severity)
    }
    if (filter.type && filter.type !== 'all') {
      clauses.push('a.type = ?')
      params.push(filter.type)
    }
    if (filter.unreadOnly) clauses.push('a.read = 0')
    if (filter.from) {
      clauses.push('a.created_at >= ?')
      params.push(filter.from)
    }
    if (filter.to) {
      clauses.push('a.created_at <= ?')
      params.push(filter.to)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 2000)
    const offset = Math.max(filter.offset ?? 0, 0)
    const rows = this.db
      .prepare(`${SELECT_BASE} ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as AlertRow[]
    return rows.map(rowToAlert)
  }

  count(filter: AlertFilter = {}): number {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.severity && filter.severity !== 'all') {
      clauses.push('severity = ?')
      params.push(filter.severity)
    }
    if (filter.unreadOnly) clauses.push('read = 0')
    if (filter.from) {
      clauses.push('created_at >= ?')
      params.push(filter.from)
    }
    if (filter.to) {
      clauses.push('created_at <= ?')
      params.push(filter.to)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM alerts ${where}`).get(...params) as {
      count: number
    }
    return row.count
  }

  unreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM alerts WHERE read = 0').get() as {
      count: number
    }
    return row.count
  }

  markRead(id: number): void {
    this.db.prepare('UPDATE alerts SET read = 1 WHERE id = ?').run(id)
  }

  markAllRead(): void {
    this.db.prepare('UPDATE alerts SET read = 1 WHERE read = 0').run()
  }

  lastForRule(rule: string): Alert | null {
    const row = this.db
      .prepare(`${SELECT_BASE} WHERE a.rule = ? ORDER BY a.created_at DESC LIMIT 1`)
      .get(rule) as AlertRow | undefined
    return row ? rowToAlert(row) : null
  }

  deleteOlderThan(timestamp: number): number {
    const info = this.db.prepare('DELETE FROM alerts WHERE created_at < ?').run(timestamp)
    return info.changes
  }

  trimTo(max: number): number {
    if (max <= 0) return 0
    const info = this.db
      .prepare(
        'DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY created_at DESC LIMIT ?)'
      )
      .run(max)
    return info.changes
  }

  clearAll(): void {
    this.db.exec('DELETE FROM alerts;')
  }
}
