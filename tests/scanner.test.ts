import { beforeEach, describe, expect, it } from 'vitest'
import type { HopResult, NetworkInfo } from '@shared/types'
import { openDatabase, type SqliteDatabase } from '../src/main/data/database'
import { DeviceRepository } from '../src/main/data/repositories/devices'
import { ScanRepository } from '../src/main/data/repositories/scans'
import { EventRepository } from '../src/main/data/repositories/events'
import { SettingsRepository } from '../src/main/data/repositories/settings'
import { SettingsStore } from '../src/main/settings/store'
import { OuiDatabase } from '../src/main/services/oui'
import { NetworkScanner, ScanError } from '../src/main/services/scanner'
import { Logger } from '../src/main/logger'
import type { ArpEntry, PingResult, PlatformAdapter, RawConnection } from '../src/main/services/platform/types'

const NOW = 1_700_000_000_000

class FakeAdapter implements PlatformAdapter {
  platform = 'linux' as const
  label = 'Fake'
  online = new Set<string>()
  arpEntries: ArpEntry[] = []
  pingCalls: string[] = []

  async getRouteInfo() {
    return { gateway: '192.168.1.1', localIp: '192.168.1.10', dns: ['192.168.1.1'], interfaceName: 'eth0', source: 'fake' }
  }
  async getArpTable(): Promise<ArpEntry[]> {
    return this.arpEntries
  }
  async getConnections(): Promise<RawConnection[]> {
    return []
  }
  async getProcessNames(): Promise<Map<number, string>> {
    return new Map()
  }
  async getInterfaceCounters() {
    return { counters: [], source: 'fake' }
  }
  async ping(host: string): Promise<PingResult> {
    this.pingCalls.push(host)
    const up = this.online.has(host)
    return {
      host,
      sent: 1,
      received: up ? 1 : 0,
      lossPercent: up ? 0 : 100,
      rttMs: up ? 2 : null,
      minMs: up ? 2 : null,
      maxMs: up ? 2 : null,
      times: up ? [2] : [],
      available: up,
      error: up ? null : 'Aucune réponse'
    }
  }
  async traceroute(): Promise<HopResult[]> {
    return []
  }
  async resolveDns(name: string) {
    return { ok: true, name, addresses: ['1.2.3.4'], durationMs: 1, error: null }
  }
  async getWifiSsid() {
    return null
  }
}

const networkInfo: NetworkInfo = {
  hostname: 'poste-test',
  localIp: '192.168.1.10',
  mac: 'b4:2e:99:aa:bb:cc',
  gateway: '192.168.1.1',
  dns: ['192.168.1.1'],
  publicIp: null,
  publicIpEnabled: false,
  interfaces: [],
  connectionType: 'ethernet',
  ssid: null,
  subnet: '192.168.1.0/24',
  updatedAt: NOW
}

let db: SqliteDatabase
let devices: DeviceRepository
let scans: ScanRepository
let events: EventRepository
let settings: SettingsStore
let adapter: FakeAdapter
let scanner: NetworkScanner
let clock: number
let deviceEvents: string[]

function createScanner(): NetworkScanner {
  return new NetworkScanner({
    adapter,
    devices,
    scans,
    events,
    oui: new OuiDatabase({ 'B42E99': 'TP-Link', 'DCA632': 'Raspberry Pi Foundation', '3C22FB': 'Apple, Inc.' }),
    getSettings: () => settings.get(),
    getNetworkInfo: async () => networkInfo,
    logger: new Logger(),
    now: () => clock,
    reverseLookup: async (ip) => (ip === '192.168.1.20' ? 'raspberrypi.lan' : null),
    probePort: async (_ip, port) => port === 22 && _ip === '192.168.1.20',
    nudge: async () => undefined,
    onDeviceEvent: (event) => deviceEvents.push(event.kind)
  })
}

beforeEach(() => {
  db = openDatabase(':memory:')
  devices = new DeviceRepository(db)
  scans = new ScanRepository(db)
  events = new EventRepository(db)
  settings = new SettingsStore(new SettingsRepository(db))
  settings.update({ scanning: { probePorts: true, resolveHostnames: true } })
  adapter = new FakeAdapter()
  clock = NOW
  deviceEvents = []
  scanner = createScanner()
})

describe('plage de scan', () => {
  it('accepte une plage privée valide', async () => {
    expect(await scanner.resolveRange('192.168.1.0/24')).toBe('192.168.1.0/24')
    expect(await scanner.resolveRange('10.0.0.0/29')).toBe('10.0.0.0/29')
  })

  it('refuse les plages publiques, invalides ou trop grandes', async () => {
    await expect(scanner.resolveRange('8.8.8.0/24')).rejects.toBeInstanceOf(ScanError)
    await expect(scanner.resolveRange('nimportequoi')).rejects.toBeInstanceOf(ScanError)
    await expect(scanner.resolveRange('10.0.0.0/8')).rejects.toBeInstanceOf(ScanError)
  })

  it('utilise le sous-réseau détecté en mode auto', async () => {
    expect(await scanner.resolveRange('auto')).toBe('192.168.1.0/24')
  })
})

describe('scan complet', () => {
  beforeEach(() => {
    adapter.online = new Set(['192.168.1.1', '192.168.1.10', '192.168.1.20'])
    adapter.arpEntries = [
      { ip: '192.168.1.1', mac: 'b4:2e:99:00:00:01', iface: 'eth0' },
      { ip: '192.168.1.20', mac: 'dc:a6:32:00:00:20', iface: 'eth0' }
    ]
  })

  it('détecte les hôtes et crée les appareils', async () => {
    const summary = await scanner.scan({ range: '192.168.1.0/27' })
    expect(summary.error).toBeNull()
    expect(summary.found).toBe(3)
    expect(summary.newDevices).toBe(3)
    const list = devices.listAll()
    expect(list).toHaveLength(3)

    const gateway = list.find((device) => device.ip === '192.168.1.1')
    expect(gateway?.isGateway).toBe(true)
    expect(gateway?.deviceType).toBe('router')
    expect(gateway?.vendor).toBe('TP-Link')

    const pi = list.find((device) => device.ip === '192.168.1.20')
    expect(pi?.hostname).toBe('raspberrypi.lan')
    expect(pi?.vendor).toBe('Raspberry Pi Foundation')
    expect(pi?.openPorts).toEqual([22])

    const local = list.find((device) => device.ip === '192.168.1.10')
    expect(local?.isLocalHost).toBe(true)
    expect(local?.mac).toBe('b4:2e:99:aa:bb:cc')

    expect(deviceEvents.filter((kind) => kind === 'new')).toHaveLength(3)
    expect(deviceEvents.filter((kind) => kind === 'unknown')).toHaveLength(3)
  })

  it('enregistre les événements et le résumé du scan', async () => {
    await scanner.scan({ range: '192.168.1.0/27' })
    const scanEvents = events.list({ categories: ['scan'] })
    expect(scanEvents).toHaveLength(1)
    expect(scanEvents[0].message).toContain('3 appareil(s) actif(s)')
    expect(scans.count()).toBe(1)
    expect(scans.last()?.found).toBe(3)
  })

  it('bascule hors ligne un appareil disparu lors du scan suivant', async () => {
    await scanner.scan({ range: '192.168.1.0/27' })
    clock = NOW + 60_000
    adapter.online = new Set(['192.168.1.1', '192.168.1.10'])
    adapter.arpEntries = [{ ip: '192.168.1.1', mac: 'b4:2e:99:00:00:01', iface: 'eth0' }]
    const summary = await scanner.scan({ range: '192.168.1.0/27' })
    expect(summary.offlineDevices).toBe(1)
    const pi = devices.listAll().find((device) => device.ip === '192.168.1.20')
    expect(pi?.status).toBe('offline')
    expect(deviceEvents).toContain('offline')
    expect(events.list({ categories: ['device'] }).some((event) => event.type === 'device-offline')).toBe(true)
  })

  it('signale un changement d’adresse IP pour une même MAC', async () => {
    await scanner.scan({ range: '192.168.1.0/27' })
    clock = NOW + 60_000
    adapter.online = new Set(['192.168.1.1', '192.168.1.10', '192.168.1.21'])
    adapter.arpEntries = [
      { ip: '192.168.1.1', mac: 'b4:2e:99:00:00:01', iface: 'eth0' },
      { ip: '192.168.1.21', mac: 'dc:a6:32:00:00:20', iface: 'eth0' }
    ]
    await scanner.scan({ range: '192.168.1.0/27' })
    expect(deviceEvents).toContain('ip-changed')
    const pi = devices.listAll().find((device) => device.mac === 'dc:a6:32:00:00:20')
    expect(pi?.ip).toBe('192.168.1.21')
    expect(devices.listAll()).toHaveLength(3)
  })

  it('détecte un hôte qui filtre l’ICMP grâce à l’ARP', async () => {
    adapter.online = new Set(['192.168.1.1', '192.168.1.10'])
    adapter.arpEntries = []
    const hiddenDevice = [{ ip: '192.168.1.30', mac: '3c:22:fb:00:00:30', iface: 'eth0' }]
    const arpScanner = new NetworkScanner({
      adapter,
      devices,
      scans,
      events,
      oui: new OuiDatabase({ '3C22FB': 'Apple, Inc.' }),
      getSettings: () => settings.get(),
      getNetworkInfo: async () => networkInfo,
      logger: new Logger(),
      now: () => clock,
      probePort: async () => false,
      nudge: async () => {
        adapter.arpEntries = hiddenDevice
      }
    })
    const summary = await arpScanner.scan({ range: '192.168.1.0/27' })
    expect(summary.found).toBe(3)
    const hidden = devices.listAll().find((device) => device.ip === '192.168.1.30')
    expect(hidden?.status).toBe('online')
    expect(hidden?.vendor).toBe('Apple, Inc.')
  })

  it('ne relance pas deux scans simultanés', async () => {
    const first = scanner.scan({ range: '192.168.1.0/27' })
    const second = scanner.scan({ range: '192.168.1.0/27' })
    expect(first).toBe(second)
    await first
  })

  it('expose la progression du scan', async () => {
    const progress: string[] = []
    const tracked = new NetworkScanner({
      adapter,
      devices,
      scans,
      events,
      oui: new OuiDatabase({}),
      getSettings: () => settings.get(),
      getNetworkInfo: async () => networkInfo,
      logger: new Logger(),
      now: () => clock,
      probePort: async () => false,
      nudge: async () => undefined,
      onProgress: (value) => progress.push(value.phase)
    })
    await tracked.scan({ range: '192.168.1.0/27' })
    expect(progress).toContain('discovering')
    expect(progress).toContain('probing')
    expect(progress).toContain('resolving')
    expect(progress).toContain('saving')
    expect(progress[progress.length - 1]).toBe('done')
  })
})
