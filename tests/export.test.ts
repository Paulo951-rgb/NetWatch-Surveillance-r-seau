import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionSnapshot } from '@shared/types'
import { openDatabase, type SqliteDatabase } from '../src/main/data/database'
import { DeviceRepository } from '../src/main/data/repositories/devices'
import { AlertRepository } from '../src/main/data/repositories/alerts'
import { EventRepository } from '../src/main/data/repositories/events'
import { TrafficRepository } from '../src/main/data/repositories/traffic'
import { SettingsRepository } from '../src/main/data/repositories/settings'
import { SettingsStore } from '../src/main/settings/store'
import { csvEscape, ExportService, toCsv, toJson } from '../src/main/data/export'
import type { DiagnosticsService } from '../src/main/services/diagnostics'

const NOW = 1_700_000_000_000
let db: SqliteDatabase
let devices: DeviceRepository
let alerts: AlertRepository
let events: EventRepository
let traffic: TrafficRepository
let settings: SettingsStore
let exporter: ExportService

beforeEach(() => {
  db = openDatabase(':memory:')
  devices = new DeviceRepository(db)
  alerts = new AlertRepository(db)
  events = new EventRepository(db)
  traffic = new TrafficRepository(db)
  settings = new SettingsStore(new SettingsRepository(db))
  devices.upsert({
    key: 'mac:aa:bb:cc:dd:ee:ff',
    ip: '192.168.1.20',
    mac: 'aa:bb:cc:dd:ee:ff',
    vendor: 'Acme; Inc',
    hostname: 'pc-salon',
    deviceType: 'computer',
    status: 'online',
    openPorts: [22, 445],
    isLocalHost: false,
    isGateway: false,
    seenAt: NOW
  })
  alerts.insert({
    type: 'new-device',
    severity: 'warning',
    title: 'Nouvel appareil',
    message: 'Un appareil "inconnu" est apparu',
    deviceId: 1,
    createdAt: NOW,
    rule: 'new-device:test'
  })
  events.insert({ category: 'scan', type: 'scan-complete', message: 'Scan terminé', createdAt: NOW })
  traffic.upsertMinute({ bucket: Math.floor(NOW / 60_000), iface: 'eth0', rxBytes: 1024, txBytes: 512, rxRate: 100, txRate: 50 })
  exporter = new ExportService({
    devices,
    alerts,
    events,
    traffic,
    diagnostics: { getLastReport: () => null } as unknown as DiagnosticsService,
    connections: async () =>
      ({
        timestamp: NOW,
        connections: [
          {
            protocol: 'TCP',
            localAddress: '192.168.1.20',
            localPort: 50000,
            remoteAddress: '1.1.1.1',
            remotePort: 443,
            state: 'ESTABLISHED',
            direction: 'outbound',
            pid: 42,
            processName: 'firefox'
          }
        ],
        counts: { total: 1, established: 1, listening: 0, tcp: 1, udp: 0 },
        topProcesses: [{ name: 'firefox', connections: 1 }]
      }) satisfies ConnectionSnapshot,
    getSettings: () => settings.get(),
    now: () => NOW
  })
})

describe('échappement CSV', () => {
  it('entoure les valeurs contenant le séparateur, des guillemets ou des retours', () => {
    expect(csvEscape('simple')).toBe('simple')
    expect(csvEscape('a;b')).toBe('"a;b"')
    expect(csvEscape('a"b')).toBe('"a""b"')
    expect(csvEscape('a\nb')).toBe('"a\nb"')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape(12)).toBe('12')
  })

  it('produit un en-tête et une ligne par enregistrement avec BOM', () => {
    const csv = toCsv([{ a: 'x', b: 1 }], [
      { key: 'a', label: 'Colonne A' },
      { key: 'b', label: 'Colonne B' }
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('Colonne A;Colonne B')
    expect(csv).toContain('x;1')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('sérialise le JSON avec un décompte', () => {
    const json = JSON.parse(toJson([{ a: 1 }]))
    expect(json.count).toBe(1)
    expect(json.rows[0].a).toBe(1)
    expect(typeof json.exportedAt).toBe('string')
  })
})

describe('service d’export', () => {
  it('exporte les appareils en CSV', async () => {
    const result = await exporter.build({ dataset: 'devices', format: 'csv' })
    expect(result.fileName.endsWith('.csv')).toBe(true)
    expect(result.rows).toBe(1)
    expect(result.content).toContain('Adresse IP')
    expect(result.content).toContain('192.168.1.20')
    expect(result.content).toContain('"Acme; Inc"')
  })

  it('exporte les alertes en JSON', async () => {
    const result = await exporter.build({ dataset: 'alerts', format: 'json' })
    const parsed = JSON.parse(result.content)
    expect(parsed.count).toBe(1)
    expect(parsed.rows[0].type).toBe('Nouvel appareil')
    expect(parsed.rows[0].severity).toBe('Avertissement')
  })

  it('exporte les connexions actives', async () => {
    const result = await exporter.build({ dataset: 'connections', format: 'csv' })
    expect(result.content).toContain('firefox')
    expect(result.content).toContain('1.1.1.1:443')
  })

  it('exporte le trafic sur une plage', async () => {
    const result = await exporter.build({
      dataset: 'traffic',
      format: 'csv',
      from: NOW - 60_000,
      to: NOW + 60_000
    })
    expect(result.rows).toBe(1)
    expect(result.content).toContain('eth0')
  })

  it('respecte le format par défaut des paramètres', async () => {
    settings.update({ export: { defaultFormat: 'json' } })
    const result = await exporter.build({ dataset: 'devices' })
    expect(result.fileName.endsWith('.json')).toBe(true)
  })

  it('renvoie un export vide pour un jeu de données inconnu', async () => {
    const result = await exporter.build({ dataset: 'inconnu' as never })
    expect(result.rows).toBe(0)
  })
})
