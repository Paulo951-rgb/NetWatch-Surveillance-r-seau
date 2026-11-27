import type { Device, DeviceStatus, DeviceType, PresenceEntry } from '@shared/types'
import type { SqliteDatabase } from '../database'

interface DeviceRow {
  id: number
  key: string
  ip: string | null
  mac: string | null
  vendor: string | null
  hostname: string | null
  device_type: string
  status: string
  first_seen: number
  last_seen: number
  last_status_change: number
  custom_name: string | null
  description: string | null
  tags: string
  approved: number
  is_new: number
  is_local_host: number
  is_gateway: number
  presence_count: number
  open_ports: string
}

export interface DeviceUpsert {
  key: string
  ip: string | null
  mac: string | null
  vendor: string | null
  hostname: string | null
  deviceType: DeviceType
  status: DeviceStatus
  openPorts: number[]
  isLocalHost: boolean
  isGateway: boolean
  seenAt: number
}

export interface DeviceFilter {
  search?: string
  status?: DeviceStatus | 'all'
  type?: DeviceType | 'all'
  approved?: 'all' | 'yes' | 'no'
  newOnly?: boolean
  limit?: number
  offset?: number
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
  } catch {
    return []
  }
}

function parsePorts(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'number') : []
  } catch {
    return []
  }
}

export function rowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    key: row.key,
    ip: row.ip,
    mac: row.mac,
    vendor: row.vendor,
    hostname: row.hostname,
    deviceType: row.device_type as DeviceType,
    status: row.status === 'online' ? 'online' : 'offline',
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastStatusChange: row.last_status_change,
    customName: row.custom_name,
    description: row.description,
    tags: parseStringArray(row.tags),
    approved: row.approved === 1,
    isNew: row.is_new === 1,
    isLocalHost: row.is_local_host === 1,
    isGateway: row.is_gateway === 1,
    presenceCount: row.presence_count,
    openPorts: parsePorts(row.open_ports)
  }
}

export class DeviceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(filter: DeviceFilter = {}): Device[] {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.search && filter.search.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`
      clauses.push(
        "(LOWER(COALESCE(ip, '')) LIKE ? OR LOWER(COALESCE(mac, '')) LIKE ? OR LOWER(COALESCE(vendor, '')) LIKE ? OR LOWER(COALESCE(hostname, '')) LIKE ? OR LOWER(COALESCE(custom_name, '')) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ? OR LOWER(tags) LIKE ?)"
      )
      params.push(term, term, term, term, term, term, term)
    }
    if (filter.status && filter.status !== 'all') {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.type && filter.type !== 'all') {
      clauses.push('device_type = ?')
      params.push(filter.type)
    }
    if (filter.approved === 'yes') clauses.push('approved = 1')
    if (filter.approved === 'no') clauses.push('approved = 0')
    if (filter.newOnly) clauses.push('is_new = 1')
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.min(Math.max(filter.limit ?? 500, 1), 5000)
    const offset = Math.max(filter.offset ?? 0, 0)
    const rows = this.db
      .prepare(
        `SELECT * FROM devices ${where} ORDER BY (status = 'online') DESC, last_seen DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DeviceRow[]
    return rows.map(rowToDevice)
  }

  get(id: number): Device | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined
    return row ? rowToDevice(row) : null
  }

  getByKey(key: string): Device | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE key = ?').get(key) as DeviceRow | undefined
    return row ? rowToDevice(row) : null
  }

  findByMac(mac: string): Device | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE mac = ? LIMIT 1').get(mac) as
      | DeviceRow
      | undefined
    return row ? rowToDevice(row) : null
  }

  findByIp(ip: string): Device | null {
    const row = this.db
      .prepare('SELECT * FROM devices WHERE ip = ? ORDER BY last_seen DESC LIMIT 1')
      .get(ip) as DeviceRow | undefined
    return row ? rowToDevice(row) : null
  }

  upsert(input: DeviceUpsert): { device: Device; created: boolean; previous: Device | null } {
    const existing = this.getByKey(input.key)
    if (!existing) {
      const info = this.db
        .prepare(
          `INSERT INTO devices (key, ip, mac, vendor, hostname, device_type, status, first_seen, last_seen,
             last_status_change, tags, approved, is_new, is_local_host, is_gateway, presence_count, open_ports)
           VALUES (@key, @ip, @mac, @vendor, @hostname, @deviceType, @status, @seenAt, @seenAt, @seenAt,
             '[]', 0, 1, @isLocalHost, @isGateway, 1, @openPorts)`
        )
        .run({
          key: input.key,
          ip: input.ip,
          mac: input.mac,
          vendor: input.vendor,
          hostname: input.hostname,
          deviceType: input.deviceType,
          status: input.status,
          seenAt: input.seenAt,
          isLocalHost: input.isLocalHost ? 1 : 0,
          isGateway: input.isGateway ? 1 : 0,
          openPorts: JSON.stringify(input.openPorts)
        })
      const id = Number(info.lastInsertRowid)
      if (input.status === 'online') this.addPresence(id, 'online', input.ip, input.seenAt)
      const device = this.get(id)
      if (!device) throw new Error("Échec de l'insertion de l'appareil")
      return { device, created: true, previous: null }
    }

    const statusChanged = existing.status !== input.status
    const presenceIncrement = statusChanged && input.status === 'online' ? 1 : 0
    this.db
      .prepare(
        `UPDATE devices SET ip = @ip, mac = @mac, vendor = @vendor, hostname = COALESCE(@hostname, hostname),
           device_type = @deviceType, status = @status, last_seen = @seenAt,
           last_status_change = CASE WHEN @statusChanged = 1 THEN @seenAt ELSE last_status_change END,
           is_local_host = @isLocalHost, is_gateway = @isGateway,
           presence_count = presence_count + @presenceIncrement,
           open_ports = @openPorts
         WHERE id = @id`
      )
      .run({
        id: existing.id,
        ip: input.ip,
        mac: input.mac,
        vendor: input.vendor,
        hostname: input.hostname,
        deviceType: input.deviceType,
        status: input.status,
        seenAt: input.seenAt,
        statusChanged: statusChanged ? 1 : 0,
        isLocalHost: input.isLocalHost ? 1 : 0,
        isGateway: input.isGateway ? 1 : 0,
        presenceIncrement,
        openPorts: JSON.stringify(input.openPorts)
      })
    if (statusChanged) this.addPresence(existing.id, input.status, input.ip, input.seenAt)
    const device = this.get(existing.id)
    if (!device) throw new Error('Appareil introuvable après mise à jour')
    return { device, created: false, previous: existing }
  }

  addPresence(deviceId: number, status: DeviceStatus, ip: string | null, changedAt: number): void {
    this.db
      .prepare('INSERT INTO device_presence (device_id, status, ip, changed_at) VALUES (?, ?, ?, ?)')
      .run(deviceId, status, ip, changedAt)
  }

  presence(deviceId: number, limit = 50): PresenceEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, device_id, status, ip, changed_at FROM device_presence WHERE device_id = ? ORDER BY changed_at DESC LIMIT ?'
      )
      .all(deviceId, limit) as {
      id: number
      device_id: number
      status: string
      ip: string | null
      changed_at: number
    }[]
    return rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      status: row.status === 'online' ? 'online' : 'offline',
      ip: row.ip,
      changedAt: row.changed_at
    }))
  }

  patch(
    id: number,
    patch: {
      customName?: string | null
      description?: string | null
      tags?: string[]
      approved?: boolean
      deviceType?: DeviceType
      isNew?: boolean
    }
  ): Device | null {
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.customName !== undefined) {
      sets.push('custom_name = ?')
      params.push(patch.customName)
    }
    if (patch.description !== undefined) {
      sets.push('description = ?')
      params.push(patch.description)
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?')
      params.push(JSON.stringify(patch.tags.slice(0, 20)))
    }
    if (patch.approved !== undefined) {
      sets.push('approved = ?')
      params.push(patch.approved ? 1 : 0)
    }
    if (patch.deviceType !== undefined) {
      sets.push('device_type = ?')
      params.push(patch.deviceType)
    }
    if (patch.isNew !== undefined) {
      sets.push('is_new = ?')
      params.push(patch.isNew ? 1 : 0)
    }
    if (sets.length === 0) return this.get(id)
    this.db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
    return this.get(id)
  }

  setStatus(id: number, status: DeviceStatus, at: number, ip: string | null): void {
    this.db
      .prepare(
        "UPDATE devices SET status = ?, last_status_change = ?, last_seen = CASE WHEN ? = 'online' THEN ? ELSE last_seen END WHERE id = ?"
      )
      .run(status, at, status, at, id)
    this.addPresence(id, status, ip, at)
  }

  setOfflineExcept(onlineIds: number[], at: number): Device[] {
    const online = new Set(onlineIds)
    const candidates = this.db
      .prepare("SELECT * FROM devices WHERE status = 'online'")
      .all() as DeviceRow[]
    const changed: Device[] = []
    for (const row of candidates) {
      if (online.has(row.id)) continue
      this.setStatus(row.id, 'offline', at, row.ip)
      const updated = this.get(row.id)
      if (updated) changed.push(updated)
    }
    return changed
  }

  counts(): {
    total: number
    online: number
    offline: number
    newDevices: number
    unknownDevices: number
    approved: number
  } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online,
           SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS offline,
           SUM(CASE WHEN is_new = 1 THEN 1 ELSE 0 END) AS newDevices,
           SUM(CASE WHEN approved = 0 THEN 1 ELSE 0 END) AS unknownDevices,
           SUM(CASE WHEN approved = 1 THEN 1 ELSE 0 END) AS approved
         FROM devices`
      )
      .get() as Record<string, number | null>
    return {
      total: Number(row.total ?? 0),
      online: Number(row.online ?? 0),
      offline: Number(row.offline ?? 0),
      newDevices: Number(row.newDevices ?? 0),
      unknownDevices: Number(row.unknownDevices ?? 0),
      approved: Number(row.approved ?? 0)
    }
  }

  typeDistribution(): { type: DeviceType; count: number }[] {
    const rows = this.db
      .prepare(
        'SELECT device_type AS type, COUNT(*) AS count FROM devices GROUP BY device_type ORDER BY count DESC'
      )
      .all() as { type: string; count: number }[]
    return rows.map((row) => ({ type: row.type as DeviceType, count: row.count }))
  }

  listOnline(): Device[] {
    const rows = this.db.prepare("SELECT * FROM devices WHERE status = 'online'").all() as DeviceRow[]
    return rows.map(rowToDevice)
  }

  listAll(): Device[] {
    const rows = this.db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all() as DeviceRow[]
    return rows.map(rowToDevice)
  }

  listApproved(): Device[] {
    const rows = this.db.prepare('SELECT * FROM devices WHERE approved = 1').all() as DeviceRow[]
    return rows.map(rowToDevice)
  }

  /** Rattache un appareil découvert par IP à sa MAC réelle. */
  rekey(id: number, newKey: string, mac: string): void {
    try {
      this.db.prepare('UPDATE devices SET key = ?, mac = ? WHERE id = ?').run(newKey, mac, id)
    } catch {
      // collision de clé : l'appareil existant est conservé
    }
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM devices WHERE id = ?').run(id)
  }

  clearAll(): void {
    this.db.exec('DELETE FROM device_presence; DELETE FROM scan_devices; DELETE FROM devices;')
  }
}
