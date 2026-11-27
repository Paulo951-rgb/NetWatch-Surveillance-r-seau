import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, SCHEMA_VERSION, type SqliteDatabase } from '../src/main/data/database'
import { DeviceRepository } from '../src/main/data/repositories/devices'
import { AlertRepository } from '../src/main/data/repositories/alerts'
import { EventRepository } from '../src/main/data/repositories/events'
import { ScanRepository } from '../src/main/data/repositories/scans'
import { TrafficRepository } from '../src/main/data/repositories/traffic'
import { LatencyRepository } from '../src/main/data/repositories/latency'
import { SettingsRepository } from '../src/main/data/repositories/settings'

let db: SqliteDatabase
let devices: DeviceRepository
let alerts: AlertRepository
let events: EventRepository
let scans: ScanRepository
let traffic: TrafficRepository
let latency: LatencyRepository
let settings: SettingsRepository

const NOW = 1_700_000_000_000

function upsertDevice(overrides: Partial<Parameters<DeviceRepository['upsert']>[0]> = {}) {
  return devices.upsert({
    key: 'mac:b4:2e:99:1a:2b:3c',
    ip: '192.168.1.20',
    mac: 'b4:2e:99:1a:2b:3c',
    vendor: 'TP-Link',
    hostname: 'prise-salon',
    deviceType: 'iot',
    status: 'online',
    openPorts: [80],
    isLocalHost: false,
    isGateway: false,
    seenAt: NOW,
    ...overrides
  })
}

beforeEach(() => {
  db = openDatabase(':memory:')
  devices = new DeviceRepository(db)
  alerts = new AlertRepository(db)
  events = new EventRepository(db)
  scans = new ScanRepository(db)
  traffic = new TrafficRepository(db)
  latency = new LatencyRepository(db)
  settings = new SettingsRepository(db)
})

describe('migrations', () => {
  it('applique le schéma et le versionne', () => {
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((table) => table.name)
    for (const table of [
      'devices',
      'device_presence',
      'scans',
      'scan_devices',
      'traffic_minutes',
      'traffic_totals',
      'alerts',
      'events',
      'latency_samples',
      'settings',
      'diagnostics'
    ]) {
      expect(names).toContain(table)
    }
  })

  it('est idempotente', () => {
    db.close()
    db = openDatabase(':memory:')
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
  })
})

describe('DeviceRepository', () => {
  it('crée puis met à jour un appareil', () => {
    const first = upsertDevice()
    expect(first.created).toBe(true)
    expect(first.device.status).toBe('online')
    expect(first.device.isNew).toBe(true)
    expect(first.device.presenceCount).toBe(1)

    const second = upsertDevice({ seenAt: NOW + 1000 })
    expect(second.created).toBe(false)
    expect(second.device.id).toBe(first.device.id)
    expect(second.device.lastSeen).toBe(NOW + 1000)
    expect(second.device.presenceCount).toBe(1)
  })

  it('enregistre les changements de présence', () => {
    const { device } = upsertDevice()
    upsertDevice({ status: 'offline', seenAt: NOW + 5000 })
    const online = upsertDevice({ status: 'online', seenAt: NOW + 9000 })
    expect(online.device.presenceCount).toBe(2)
    const history = devices.presence(device.id)
    expect(history.map((entry) => entry.status)).toEqual(['online', 'offline', 'online'])
  })

  it('compte les appareils par état', () => {
    upsertDevice()
    upsertDevice({
      key: 'mac:dc:a6:32:11:22:33',
      mac: 'dc:a6:32:11:22:33',
      ip: '192.168.1.21',
      status: 'offline'
    })
    devices.patch(devices.list()[0].id, { approved: true })
    const counts = devices.counts()
    expect(counts.total).toBe(2)
    expect(counts.online).toBe(1)
    expect(counts.offline).toBe(1)
    expect(counts.approved).toBe(1)
    expect(counts.unknownDevices).toBe(1)
  })

  it('filtre par recherche, état et type', () => {
    upsertDevice()
    upsertDevice({
      key: 'mac:dc:a6:32:11:22:33',
      mac: 'dc:a6:32:11:22:33',
      ip: '192.168.1.21',
      hostname: 'imprimante-bureau',
      deviceType: 'printer',
      status: 'offline'
    })
    expect(devices.list({ search: 'imprimante' })).toHaveLength(1)
    expect(devices.list({ status: 'offline' })).toHaveLength(1)
    expect(devices.list({ type: 'iot' })).toHaveLength(1)
    expect(devices.list({ approved: 'no' })).toHaveLength(2)
  })

  it('met à jour les métadonnées personnalisées', () => {
    const { device } = upsertDevice()
    const patched = devices.patch(device.id, {
      customName: 'Prise bureau',
      description: 'Mesure la consommation',
      tags: ['domotique', 'salon'],
      approved: true,
      deviceType: 'iot'
    })
    expect(patched?.customName).toBe('Prise bureau')
    expect(patched?.tags).toEqual(['domotique', 'salon'])
    expect(patched?.approved).toBe(true)
  })

  it('bascule hors ligne les appareils absents', () => {
    const a = upsertDevice()
    const b = upsertDevice({
      key: 'mac:aa:aa:aa:aa:aa:aa',
      mac: 'aa:aa:aa:aa:aa:aa',
      ip: '192.168.1.22'
    })
    const changed = devices.setOfflineExcept([a.device.id], NOW + 2000)
    expect(changed).toHaveLength(1)
    expect(changed[0].id).toBe(b.device.id)
    expect(devices.get(b.device.id)?.status).toBe('offline')
    expect(devices.get(a.device.id)?.status).toBe('online')
  })

  it('répartit les types d appareils', () => {
    upsertDevice()
    upsertDevice({ key: 'mac:dc:a6:32:11:22:33', mac: 'dc:a6:32:11:22:33', deviceType: 'computer' })
    expect(devices.typeDistribution()).toHaveLength(2)
  })
})

describe('AlertRepository', () => {
  it('insère, liste et marque comme lues', () => {
    const alert = alerts.insert({
      type: 'new-device',
      severity: 'warning',
      title: 'Nouvel appareil',
      message: 'Un appareil est apparu',
      createdAt: NOW
    })
    expect(alert.read).toBe(false)
    expect(alerts.unreadCount()).toBe(1)
    alerts.markRead(alert.id)
    expect(alerts.unreadCount()).toBe(0)
    expect(alerts.list()[0].read).toBe(true)
  })

  it('joint le nom de l appareil concerné', () => {
    const { device } = upsertDevice()
    devices.patch(device.id, { customName: 'Prise salon' })
    alerts.insert({
      type: 'unknown-device',
      severity: 'warning',
      title: 'Appareil inconnu',
      message: 'x',
      deviceId: device.id,
      createdAt: NOW
    })
    expect(alerts.list()[0].deviceName).toBe('Prise salon')
  })

  it('filtre et limite la purge', () => {
    for (let i = 0; i < 5; i++) {
      alerts.insert({
        type: 'high-latency',
        severity: i % 2 === 0 ? 'warning' : 'info',
        title: `Alerte ${i}`,
        message: 'm',
        createdAt: NOW + i
      })
    }
    expect(alerts.count({ severity: 'warning' })).toBe(3)
    expect(alerts.list({ limit: 2 })).toHaveLength(2)
    expect(alerts.deleteOlderThan(NOW + 2)).toBe(2)
    expect(alerts.count()).toBe(3)
    expect(alerts.trimTo(1)).toBe(2)
    expect(alerts.count()).toBe(1)
  })
})

describe('EventRepository', () => {
  it('insère et filtre par catégorie, période et recherche', () => {
    events.insert({
      category: 'device',
      type: 'new-device',
      message: 'Nouvel appareil détecté',
      createdAt: NOW
    })
    events.insert({
      category: 'network',
      type: 'ip-change',
      message: 'Adresse IP modifiée',
      createdAt: NOW + 1000
    })
    events.insert({ category: 'alert', type: 'x', message: 'Alerte', createdAt: NOW + 2000, meta: { a: 1 } })

    expect(events.count()).toBe(3)
    expect(events.list({ categories: ['device'] })).toHaveLength(1)
    expect(events.list({ search: 'ip modifiée' })).toHaveLength(1)
    expect(events.list({ from: NOW + 1500 })).toHaveLength(1)
    expect(events.list()[0].meta).toEqual({ a: 1 })
  })
})

describe('ScanRepository', () => {
  it('enregistre un scan et ses appareils', () => {
    const { device } = upsertDevice()
    const id = scans.create(NOW, '192.168.1.0/24', 'manual')
    scans.recordDevice(id, device.id, 'online', device.ip)
    scans.finish(id, {
      finishedAt: NOW + 4000,
      found: 1,
      newDevices: 1,
      offlineDevices: 0,
      durationMs: 4000
    })
    expect(scans.get(id)?.found).toBe(1)
    expect(scans.last()?.id).toBe(id)
    expect(scans.deviceIdsForScan(id)).toEqual([device.id])
    expect(scans.firstScanForDevice(device.id)).toBe(id)
    expect(scans.count()).toBe(1)
  })

  it('ignore les scans non terminés dans last()', () => {
    scans.create(NOW, '192.168.1.0/24', 'manual')
    expect(scans.last()).toBeNull()
  })
})

describe('TrafficRepository', () => {
  it('agrège les minutes et calcule les débits', () => {
    const minute = Math.floor(NOW / 60_000)
    traffic.upsertMinute({ bucket: minute, iface: 'eth0', rxBytes: 600, txBytes: 300, rxRate: 10, txRate: 5 })
    traffic.upsertMinute({ bucket: minute, iface: 'eth0', rxBytes: 600, txBytes: 300, rxRate: 20, txRate: 6 })
    const series = traffic.series('30m', NOW)
    expect(series).toHaveLength(1)
    expect(series[0].rx).toBeCloseTo(1200 / 60, 5)
    expect(traffic.totalsForPeriod('30m', NOW)).toEqual({ rxTotal: 1200, txTotal: 600 })
  })

  it('mémorise les totaux cumulés', () => {
    traffic.setTotals('eth0', 1000, 500, NOW)
    traffic.setTotals('eth0', 2000, 900, NOW + 1)
    expect(traffic.getTotals().get('eth0')).toEqual({ rxTotal: 2000, txTotal: 900 })
  })
})

describe('LatencyRepository et SettingsRepository', () => {
  it('enregistre et moyenne la latence', () => {
    latency.insert({ timestamp: NOW, gatewayMs: 1, internetMs: 12, jitterMs: 1, lossPercent: 0 })
    latency.insert({ timestamp: NOW + 1000, gatewayMs: 2, internetMs: 14, jitterMs: 1, lossPercent: 0 })
    const recent = latency.recent()
    expect(recent).toHaveLength(2)
    expect(recent[1].internetMs).toBe(14)
    const buckets = latency.averageByBucket(NOW, NOW + 1000, 5000)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].internetMs).toBe(13)
  })

  it('persiste les paramètres', () => {
    settings.setMany({ theme: '"dark"', 'scanning.intervalMinutes': '15' })
    settings.set('theme', '"light"')
    expect(settings.all()).toEqual({ theme: '"light"', 'scanning.intervalMinutes': '15' })
  })
})
