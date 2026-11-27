import type { ScanSummary } from '@shared/types'
import type { SqliteDatabase } from '../database'

interface ScanRow {
  id: number
  started_at: number
  finished_at: number | null
  range: string
  trigger: string
  found: number
  new_devices: number
  offline_devices: number
  duration_ms: number
  error: string | null
}

function rowToScan(row: ScanRow): ScanSummary {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    range: row.range,
    trigger: row.trigger as ScanSummary['trigger'],
    found: row.found,
    newDevices: row.new_devices,
    offlineDevices: row.offline_devices,
    durationMs: row.duration_ms,
    error: row.error
  }
}

export class ScanRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(startedAt: number, range: string, trigger: ScanSummary['trigger']): number {
    const info = this.db
      .prepare('INSERT INTO scans (started_at, range, trigger) VALUES (?, ?, ?)')
      .run(startedAt, range, trigger)
    return Number(info.lastInsertRowid)
  }

  finish(
    id: number,
    data: {
      finishedAt: number
      found: number
      newDevices: number
      offlineDevices: number
      durationMs: number
      error?: string | null
    }
  ): void {
    this.db
      .prepare(
        'UPDATE scans SET finished_at = ?, found = ?, new_devices = ?, offline_devices = ?, duration_ms = ?, error = ? WHERE id = ?'
      )
      .run(
        data.finishedAt,
        data.found,
        data.newDevices,
        data.offlineDevices,
        data.durationMs,
        data.error ?? null,
        id
      )
  }

  get(id: number): ScanSummary | null {
    const row = this.db.prepare('SELECT * FROM scans WHERE id = ?').get(id) as ScanRow | undefined
    return row ? rowToScan(row) : null
  }

  last(offset = 0): ScanSummary | null {
    const row = this.db
      .prepare(
        'SELECT * FROM scans WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1 OFFSET ?'
      )
      .get(offset) as ScanRow | undefined
    return row ? rowToScan(row) : null
  }

  recent(limit = 20): ScanSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM scans ORDER BY started_at DESC LIMIT ?')
      .all(limit) as ScanRow[]
    return rows.map(rowToScan)
  }

  recordDevice(scanId: number, deviceId: number, status: string, ip: string | null): void {
    this.db
      .prepare('INSERT OR REPLACE INTO scan_devices (scan_id, device_id, status, ip) VALUES (?, ?, ?, ?)')
      .run(scanId, deviceId, status, ip)
  }

  deviceIdsForScan(scanId: number): number[] {
    const rows = this.db
      .prepare('SELECT device_id FROM scan_devices WHERE scan_id = ?')
      .all(scanId) as { device_id: number }[]
    return rows.map((row) => row.device_id)
  }

  firstScanForDevice(deviceId: number): number | null {
    const row = this.db
      .prepare('SELECT MIN(scan_id) AS scan_id FROM scan_devices WHERE device_id = ?')
      .get(deviceId) as { scan_id: number | null }
    return row?.scan_id ?? null
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM scans').get() as { count: number }
    return row.count
  }

  deleteOlderThan(timestamp: number): number {
    const info = this.db.prepare('DELETE FROM scans WHERE started_at < ?').run(timestamp)
    return info.changes
  }
}
