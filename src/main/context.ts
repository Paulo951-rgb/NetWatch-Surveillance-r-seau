import { join } from 'node:path'
import type { Device, Settings } from '@shared/types'
import { openDatabase, type SqliteDatabase } from './data/database'
import { DeviceRepository } from './data/repositories/devices'
import { AlertRepository } from './data/repositories/alerts'
import { EventRepository } from './data/repositories/events'
import { ScanRepository } from './data/repositories/scans'
import { TrafficRepository } from './data/repositories/traffic'
import { LatencyRepository } from './data/repositories/latency'
import { DiagnosticsRepository } from './data/repositories/diagnostics'
import { SettingsRepository } from './data/repositories/settings'
import { SettingsStore } from './settings/store'
import { Logger } from './logger'
import { createPlatformAdapter, type PlatformAdapter } from './services/platform'
import { OuiDatabase } from './services/oui'
import { NetworkInfoService } from './services/network-info'
import { TrafficMonitor } from './services/traffic'
import { ConnectivityMonitor } from './services/connectivity'
import { ConnectionService } from './services/connections'
import { NetworkScanner } from './services/scanner'
import { DiagnosticsService } from './services/diagnostics'
import { AlertEngine } from './alerts/engine'
import { ExportService } from './data/export'
import { isVirtualInterfaceName } from './services/network-info'

export interface AppPaths {
  dataDir: string
  databasePath: string
  logPath: string
  ouiPath: string
}

export interface AppContextOptions {
  paths: AppPaths
  emit: (channel: string, payload: unknown) => void
  notify?: (title: string, body: string) => void
  adapter?: PlatformAdapter
  now?: () => number
}

export interface AppContext {
  paths: AppPaths
  logger: Logger
  db: SqliteDatabase
  adapter: PlatformAdapter
  settings: SettingsStore
  devices: DeviceRepository
  alerts: AlertRepository
  events: EventRepository
  scans: ScanRepository
  trafficRepo: TrafficRepository
  latencyRepo: LatencyRepository
  diagnosticsRepo: DiagnosticsRepository
  settingsRepo: SettingsRepository
  oui: OuiDatabase
  networkInfo: NetworkInfoService
  trafficMonitor: TrafficMonitor
  connectivity: ConnectivityMonitor
  connections: ConnectionService
  scanner: NetworkScanner
  alertEngine: AlertEngine
  diagnostics: DiagnosticsService
  exporter: ExportService
  startedAt: number
  emit: (channel: string, payload: unknown) => void
  close(): void
}

export function buildPaths(dataDir: string, resourceDir: string): AppPaths {
  return {
    dataDir,
    databasePath: join(dataDir, 'netwatch.db'),
    logPath: join(dataDir, 'logs', 'netwatch.log'),
    ouiPath: join(resourceDir, 'oui.json')
  }
}

export function createAppContext(options: AppContextOptions): AppContext {
  const { paths } = options
  const now = options.now ?? Date.now
  const logger = new Logger(paths.logPath)
  logger.info('Démarrage de NetWatch', { dataDir: paths.dataDir })

  const db = openDatabase(paths.databasePath)
  const devices = new DeviceRepository(db)
  const alerts = new AlertRepository(db)
  const events = new EventRepository(db)
  const scans = new ScanRepository(db)
  const trafficRepo = new TrafficRepository(db)
  const latencyRepo = new LatencyRepository(db)
  const diagnosticsRepo = new DiagnosticsRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const settings = new SettingsStore(settingsRepo)
  const adapter = options.adapter ?? createPlatformAdapter()
  const oui = OuiDatabase.load(paths.ouiPath)
  logger.info(`Base fabricants chargée : ${oui.size} préfixes`)

  const getSettings = (): Settings => settings.get()

  const networkInfo = new NetworkInfoService({ adapter, getSettings, logger, now })

  const trafficMonitor = new TrafficMonitor({
    adapter,
    repo: trafficRepo,
    logger,
    now,
    isExcluded: isVirtualInterfaceName
  })

  const connectivity = new ConnectivityMonitor({
    adapter,
    networkInfo,
    getSettings,
    repo: latencyRepo,
    logger,
    now
  })

  const connections = new ConnectionService({
    adapter,
    logger,
    now,
    localSubnet: () => {
      const info = networkInfo.getLastCached()
      if (!info?.localIp) return null
      const entry = info.interfaces.find((item) => item.address === info.localIp)
      if (!entry) return null
      const [network] = (entry.cidr ?? '').split('/')
      return network ? { network, netmask: entry.netmask } : null
    }
  })

  const alertEngine = new AlertEngine({
    alerts,
    events,
    getSettings,
    logger,
    now,
    onAlert: (alert) => {
      options.emit('live:alert', alert)
      const minSeverity = getSettings().notifications.minSeverity
      const order = { info: 1, warning: 2, critical: 3 }
      if (order[alert.severity] >= order[minSeverity]) {
        options.notify?.(alert.title, alert.message)
      }
    }
  })

  const scanner = new NetworkScanner({
    adapter,
    devices,
    scans,
    events,
    oui,
    getSettings,
    getNetworkInfo: () => networkInfo.get(),
    logger,
    now,
    onProgress: (progress) => options.emit('live:scan-progress', progress),
    onDeviceEvent: (event) => {
      alertEngine.handleDeviceEvent(event)
      if (event.kind === 'new' || event.kind === 'online' || event.kind === 'offline') {
        options.emit('live:devices', devices.list({ limit: 1000 }))
      }
    }
  })

  const diagnostics = new DiagnosticsService({
    adapter,
    networkInfo,
    repo: diagnosticsRepo,
    getSettings,
    logger,
    now
  })

  const exporter = new ExportService({
    devices,
    alerts,
    events,
    traffic: trafficRepo,
    diagnostics,
    connections: () => connections.snapshot(),
    getSettings,
    now
  })

  settings.onChange((value) => options.emit('live:settings', value))

  return {
    paths,
    logger,
    db,
    adapter,
    settings,
    devices,
    alerts,
    events,
    scans,
    trafficRepo,
    latencyRepo,
    diagnosticsRepo,
    settingsRepo,
    oui,
    networkInfo,
    trafficMonitor,
    connectivity,
    connections,
    scanner,
    alertEngine,
    diagnostics,
    exporter,
    startedAt: now(),
    emit: options.emit,
    close: () => {
      try {
        trafficMonitor.flush()
      } catch (error) {
        logger.warn('Écriture du trafic à l’arrêt impossible', error)
      }
      try {
        db.close()
      } catch {
        // déjà fermée
      }
    }
  }
}

/** Liste des appareils triée pour l'interface. */
export function sortDevices(list: Device[]): Device[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1
    return b.lastSeen - a.lastSeen
  })
}
