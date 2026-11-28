import { beforeEach, describe, expect, it } from 'vitest'
import type { Alert, ConnectivityStatus, Device, TrafficSnapshot } from '@shared/types'
import { openDatabase, type SqliteDatabase } from '../src/main/data/database'
import { AlertRepository } from '../src/main/data/repositories/alerts'
import { EventRepository } from '../src/main/data/repositories/events'
import { SettingsRepository } from '../src/main/data/repositories/settings'
import { SettingsStore } from '../src/main/settings/store'
import { AlertEngine } from '../src/main/alerts/engine'
import { Logger } from '../src/main/logger'

const NOW = 1_700_000_000_000

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 1,
    key: 'mac:aa:bb:cc:dd:ee:ff',
    ip: '192.168.1.42',
    mac: 'aa:bb:cc:dd:ee:ff',
    vendor: 'Acme',
    hostname: 'acme-pc',
    customName: null,
    description: null,
    tags: [],
    deviceType: 'computer',
    status: 'online',
    approved: false,
    firstSeen: NOW - 1000,
    lastSeen: NOW,
    lastStatusChange: NOW,
    presenceCount: 1,
    openPorts: [],
    isGateway: false,
    isLocalHost: false,
    isNew: true,
    ...overrides
  }
}

function status(overrides: Partial<ConnectivityStatus> = {}): ConnectivityStatus {
  return {
    internet: true,
    gateway: true,
    dns: true,
    latencyMs: 20,
    gatewayLatencyMs: 2,
    jitterMs: 1,
    packetLoss: 0,
    checking: false,
    lastCheck: NOW,
    ...overrides
  }
}

let db: SqliteDatabase
let alerts: AlertRepository
let events: EventRepository
let settings: SettingsStore
let clock: number
let emitted: Alert[]
let notified: Alert[]

function engine(): AlertEngine {
  return new AlertEngine({
    alerts,
    events,
    getSettings: () => settings.get(),
    logger: new Logger(),
    now: () => clock,
    onAlert: (alert) => emitted.push(alert),
    notify: (alert) => notified.push(alert)
  })
}

beforeEach(() => {
  db = openDatabase(':memory:')
  alerts = new AlertRepository(db)
  events = new EventRepository(db)
  settings = new SettingsStore(new SettingsRepository(db))
  clock = NOW
  emitted = []
  notified = []
})

describe('moteur d’alertes', () => {
  it('alerte sur un nouvel appareil et journalise l’événement', () => {
    const result = engine().handleDeviceEvent({ kind: 'new', device: device() })
    const list = alerts.list({})
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('new-device')
    expect(list[0].message).toContain('192.168.1.42')
    expect(emitted).toHaveLength(1)
    expect(events.list({ categories: ['alert'] })).toHaveLength(1)
    expect(result).toBeUndefined()
  })

  it('alerte spécifiquement sur un appareil non approuvé', () => {
    engine().handleDeviceEvent({ kind: 'unknown', device: device() })
    const list = alerts.list({})
    expect(list[0].type).toBe('unknown-device')
    expect(list[0].severity).toBe('warning')
  })

  it('n’alerte pas si la règle est désactivée', () => {
    settings.update({ alerts: { newDevice: false, unknownDevice: false } })
    engine().handleDeviceEvent({ kind: 'new', device: device() })
    engine().handleDeviceEvent({ kind: 'unknown', device: device() })
    expect(alerts.list({})).toHaveLength(0)
  })

  it('respecte le délai de repos entre deux alertes identiques', () => {
    const instance = engine()
    instance.handleDeviceEvent({ kind: 'new', device: device() })
    clock += 60_000
    instance.handleDeviceEvent({ kind: 'new', device: device() })
    expect(alerts.list({})).toHaveLength(1)
    clock += settings.get().alerts.cooldownMinutes * 60_000 + 1
    instance.handleDeviceEvent({ kind: 'new', device: device() })
    expect(alerts.list({})).toHaveLength(2)
  })

  it('signale la perte puis le retour de la connexion Internet', () => {
    const instance = engine()
    instance.onConnectivityChange(status(), status({ internet: false, latencyMs: null }))
    expect(alerts.list({})[0].type).toBe('internet-lost')
    clock += settings.get().alerts.cooldownMinutes * 60_000 + 1
    instance.onConnectivityChange(status({ internet: false }), status())
    const types = alerts.list({}).map((alert) => alert.type)
    expect(types).toContain('internet-restored')
  })

  it('alerte au-delà du seuil de latence', () => {
    const instance = engine()
    instance.onConnectivityChange(status(), status({ latencyMs: 400 }))
    expect(alerts.list({})[0].type).toBe('high-latency')
    expect(alerts.list({})[0].message).toContain('400')
  })

  it('alerte sur un débit inhabituel', () => {
    const snapshot: TrafficSnapshot = {
      timestamp: clock,
      rxRate: 9_000_000,
      txRate: 2_000_000,
      rxTotal: 0,
      txTotal: 0,
      interfaces: [],
      source: 'test'
    }
    engine().onTraffic(snapshot)
    expect(alerts.list({})[0].type).toBe('high-traffic')
  })

  it('détecte une variation par rapport au comportement habituel, sans la présenter comme une attaque', () => {
    const instance = engine()
    const snapshot = (rxRate: number): TrafficSnapshot => ({
      timestamp: clock,
      rxRate,
      txRate: 0,
      rxTotal: 0,
      txTotal: 0,
      interfaces: [],
      source: 'test'
    })

    // 30 échantillons calmes : ~200 kbit/s
    for (let index = 0; index < 30; index++) instance.onTraffic(snapshot(25_000))
    expect(alerts.list({})).toHaveLength(0)

    // Pic à 40 Mbit/s : très au-dessus de la moyenne et de l'écart-type
    instance.onTraffic(snapshot(5_000_000))
    const raised = alerts.list({})
    expect(raised).toHaveLength(1)
    expect(raised[0].type).toBe('traffic-anomaly')
    expect(raised[0].message).toContain('moyenne')
    expect(raised[0].message).toContain('nécessairement')
  })

  it('ignore le bruit de fond et laisse la règle désactivable', () => {
    const instance = engine()
    const snapshot: TrafficSnapshot = {
      timestamp: clock,
      rxRate: 30_000,
      txRate: 20_000,
      rxTotal: 0,
      txTotal: 0,
      interfaces: [],
      source: 'test'
    }
    for (let index = 0; index < 40; index++) instance.onTraffic(snapshot)
    expect(alerts.list({})).toHaveLength(0)

    settings.update({ alerts: { trafficAnomaly: false } })
    const second = engine()
    for (let index = 0; index < 30; index++) second.onTraffic(snapshot)
    second.onTraffic({ ...snapshot, rxRate: 8_000_000 })
    expect(alerts.list({})).toHaveLength(0)
  })

  it('signale un changement d’adresse IP locale et de passerelle', () => {
    const instance = engine()
    const previous = {
      hostname: 'pc',
      localIp: '192.168.1.10',
      mac: null,
      gateway: '192.168.1.1',
      dns: [],
      publicIp: null,
      publicIpEnabled: false,
      interfaces: [],
      connectionType: 'ethernet' as const,
      ssid: null,
      subnet: '192.168.1.0/24',
      updatedAt: clock
    }
    instance.onNetworkInfoChange(previous, { ...previous, localIp: '192.168.1.11', gateway: '192.168.1.254' })
    const types = alerts.list({}).map((alert) => alert.type)
    expect(types).toContain('local-ip-changed')
    expect(types).toContain('gateway-changed')
  })

  it('envoie une notification système selon la priorité minimale', () => {
    settings.update({ notifications: { enabled: true, native: true, minSeverity: 'warning' } })
    engine().handleDeviceEvent({ kind: 'new', device: device() })
    expect(notified).toHaveLength(0)
    engine().handleDeviceEvent({ kind: 'offline', device: device() })
    expect(notified).toHaveLength(1)
  })

  it('ignore les notifications quand elles sont désactivées', () => {
    settings.update({ notifications: { enabled: false } })
    engine().handleDeviceEvent({ kind: 'offline', device: device() })
    expect(alerts.list({})).toHaveLength(1)
    expect(notified).toHaveLength(0)
  })

  it('signale les appareils hors ligne depuis longtemps', () => {
    clock = NOW + 3600_000
    engine().checkOfflineDevices([device({ status: 'offline', lastStatusChange: NOW - 3600_000 })])
    const list = alerts.list({})
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('device-offline')
    expect(list[0].message).toContain('minutes')
  })
})
