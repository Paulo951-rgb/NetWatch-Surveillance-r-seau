import { beforeEach, describe, expect, it } from 'vitest'
import { sleep } from '@shared/async'
import { openDatabase, type SqliteDatabase } from '../src/main/data/database'
import { TrafficRepository } from '../src/main/data/repositories/traffic'
import { LatencyRepository } from '../src/main/data/repositories/latency'
import { DiagnosticsRepository } from '../src/main/data/repositories/diagnostics'
import { SettingsRepository } from '../src/main/data/repositories/settings'
import { SettingsStore } from '../src/main/settings/store'
import { Logger } from '../src/main/logger'
import { createPlatformAdapter } from '../src/main/services/platform'
import { NetworkInfoService, isVirtualInterfaceName } from '../src/main/services/network-info'
import { TrafficMonitor } from '../src/main/services/traffic'
import { ConnectivityMonitor } from '../src/main/services/connectivity'
import { DiagnosticsService } from '../src/main/services/diagnostics'
import { OuiDatabase } from '../src/main/services/oui'
import { tcpLatencyPing } from '../src/main/services/platform/tcp-ping'
import { parseProcNet } from '../src/main/services/platform/parsers/procnet'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'

/**
 * Tests d'intégration : ils utilisent le véritable adaptateur système
 * (Linux ici, Windows/macOS en CI locale) et n'utilisent aucune donnée simulée.
 */
const adapter = createPlatformAdapter()
const logger = new Logger()

let db: SqliteDatabase
let settings: SettingsStore
let networkInfo: NetworkInfoService

beforeEach(() => {
  db = openDatabase(':memory:')
  settings = new SettingsStore(new SettingsRepository(db))
  networkInfo = new NetworkInfoService({ adapter, getSettings: () => settings.get(), logger })
})

describe('adaptateur système réel', () => {
  it('expose une plateforme et un libellé', () => {
    expect(['linux', 'win32', 'darwin']).toContain(adapter.platform)
    expect(adapter.label.length).toBeGreaterThan(0)
  })

  it('interroge la boucle locale (ICMP ou repli TCP documenté)', async () => {
    const result = await adapter.ping('127.0.0.1', { count: 2, timeoutMs: 1500 })
    expect(result.sent).toBe(2)
    if (result.method === 'tcp') {
      // Système sans binaire ping : la mesure bascule sur TCP, aucun port local n'écoute ici.
      expect(result.received).toBe(0)
      expect(result.error).toBeTruthy()
    } else {
      expect(result.received).toBeGreaterThan(0)
      expect(result.rttMs).not.toBeNull()
    }
  })

  it('mesure une latence TCP réelle vers un serveur local', async () => {
    const server = createServer((socket) => socket.end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const result = await tcpLatencyPing('127.0.0.1', { count: 3, timeoutMs: 800, ports: [port] })
      expect(result.received).toBe(3)
      expect(result.rttMs).toBeGreaterThanOrEqual(0)
      expect(result.lossPercent).toBe(0)
      expect(result.method).toBe('tcp')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('lit la table ARP du système', async () => {
    const entries = await adapter.getArpTable()
    expect(Array.isArray(entries)).toBe(true)
  })

  it('lit les connexions réseau actives', async () => {
    const connections = await adapter.getConnections()
    expect(Array.isArray(connections)).toBe(true)
    if (adapter.platform === 'linux') expect(connections.length).toBeGreaterThan(0)
    for (const entry of connections.slice(0, 5)) {
      expect(['TCP', 'UDP']).toContain(entry.protocol)
      expect(typeof entry.localPort).toBe('number')
    }
  })

  it('lit les compteurs des interfaces', async () => {
    const counters = await adapter.getInterfaceCounters()
    expect(counters.counters.length).toBeGreaterThan(0)
    for (const entry of counters.counters) {
      expect(entry.rxBytes).toBeGreaterThanOrEqual(0)
      expect(entry.txBytes).toBeGreaterThanOrEqual(0)
    }
  })

  it('résout un nom local', async () => {
    const result = await adapter.resolveDns('localhost')
    expect(result.ok).toBe(true)
    expect(result.addresses.length).toBeGreaterThan(0)
  })

  it('lit la configuration réseau réelle', async () => {
    const info = await networkInfo.get()
    expect(info.hostname.length).toBeGreaterThan(0)
    expect(info.interfaces.length).toBeGreaterThan(0)
    expect(info.updatedAt).toBeGreaterThan(0)
    expect(info.interfaces.some((entry) => isVirtualInterfaceName(entry.name))).toBe(
      info.interfaces.some((entry) => entry.virtual)
    )
  })
})

describe('collecte du trafic', () => {
  it('mesure deux échantillons réels et alimente la série', async () => {
    const monitor = new TrafficMonitor({
      adapter,
      repo: new TrafficRepository(db),
      logger,
      isExcluded: isVirtualInterfaceName
    })
    const first = await monitor.sample()
    expect(first.rxTotal).toBeGreaterThanOrEqual(0)
    await sleep(1200)
    const second = await monitor.sample()
    expect(second.timestamp).toBeGreaterThanOrEqual(first.timestamp)
    expect(second.interfaces.length).toBeGreaterThan(0)
    expect(monitor.getHistory().length).toBeGreaterThanOrEqual(2)
    const series = monitor.series('5m')
    expect(series.points.length).toBeGreaterThan(0)
    expect(series.rxTotal).toBeGreaterThanOrEqual(0)
    expect(series.period).toBe('5m')
  })
})

describe('supervision de la connectivité', () => {
  it('produit un état de connexion mesuré', async () => {
    const monitor = new ConnectivityMonitor({
      adapter,
      networkInfo,
      getSettings: () => settings.get(),
      repo: new LatencyRepository(db),
      logger
    })
    const status = await monitor.check()
    expect(status.checking).toBe(false)
    expect(status.lastCheck).toBeGreaterThan(0)
    expect(typeof status.internet).toBe('boolean')
    expect(typeof status.gateway).toBe('boolean')
    const latest = monitor.getLatest()
    expect(latest).not.toBeNull()
    expect(monitor.getHistory().length).toBeGreaterThan(0)
  }, 40000)
})

describe('diagnostic', () => {
  it('inspecte les interfaces réelles', async () => {
    const diagnostics = new DiagnosticsService({
      adapter,
      networkInfo,
      repo: new DiagnosticsRepository(db),
      getSettings: () => settings.get(),
      logger
    })
    const result = await diagnostics.runOne('interfaces')
    expect(['ok', 'warning', 'error', 'skipped']).toContain(result.status)
    expect(result.label).toBe('Interfaces réseau')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('valide la configuration locale', async () => {
    const diagnostics = new DiagnosticsService({
      adapter,
      networkInfo,
      repo: new DiagnosticsRepository(db),
      getSettings: () => settings.get(),
      logger
    })
    const result = await diagnostics.runOne('local-config')
    expect(result.metrics.length).toBeGreaterThan(0)
    expect(['ok', 'warning', 'error']).toContain(result.status)
  })

  it('enregistre un rapport complet', async () => {
    const repo = new DiagnosticsRepository(db)
    const diagnostics = new DiagnosticsService({
      adapter,
      networkInfo,
      repo,
      getSettings: () => settings.get(),
      logger
    })
    const report = await diagnostics.runAll()
    expect(report.results.length).toBeGreaterThanOrEqual(7)
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.score).toBeLessThanOrEqual(100)
    expect(diagnostics.getLastReport()?.results.length).toBe(report.results.length)
  }, 120000)
})

describe('analyse /proc/net (sans ss ni netstat)', () => {
  it('décode les adresses, ports et états', () => {
    const content = readFileSync('tests/fixtures/linux/proc-net-tcp.txt', 'utf8')
    const entries = parseProcNet(content, 'TCP')
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({
      localAddress: '127.0.0.1',
      localPort: 8080,
      remoteAddress: '*',
      state: 'LISTEN',
      inode: 23456
    })
    expect(entries[1]).toMatchObject({
      localAddress: '127.0.0.1',
      localPort: 40000,
      remoteAddress: '127.0.0.1',
      remotePort: 8080,
      state: 'ESTABLISHED'
    })
    expect(entries[2]).toMatchObject({
      localAddress: '10.0.2.10',
      remoteAddress: '10.0.2.5',
      state: 'ESTABLISHED'
    })
  })

  it('ignore les lignes incomplètes', () => {
    expect(parseProcNet('  sl  local_address\n   0: 0100007F:1F90', 'TCP')).toHaveLength(0)
  })
})

describe('base fabricants', () => {
  it('retrouve un fabricant à partir d’une adresse MAC', () => {
    const oui = new OuiDatabase({ B42E99: 'TP-Link', '3C22FB': 'Apple, Inc.' })
    expect(oui.lookup('b4:2e:99:12:34:56')).toBe('TP-Link')
    expect(oui.lookup('3C-22-FB-AA-BB-CC')).toBe('Apple, Inc.')
    expect(oui.lookup('zz:zz:zz:zz:zz:zz')).toBeNull()
    expect(oui.size).toBe(2)
  })

  it('charge la base embarquée du dépôt', () => {
    const oui = OuiDatabase.load('resources/oui.json')
    expect(oui.size).toBeGreaterThan(30000)
    expect(oui.lookup('00:1A:2B:00:00:01')).toBeTruthy()
  })
})
