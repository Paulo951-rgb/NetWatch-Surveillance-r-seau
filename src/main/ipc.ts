import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  DashboardSnapshot,
  EventCategory,
  DeviceDetail,
  DevicePatch,
  ExportResult,
  HistoryPage,
  HistoryQuery,
  ScanComparison,
  ScanOptions,
  Settings,
  TrafficPeriod
} from '@shared/types'
import { IPC, type AlertListQuery, type DataStats, type DeviceListQuery } from '@shared/ipc'
import { periodConfig } from './data/repositories/traffic'
import { checkSender } from './security'
import { asEnum, asHost, asInt, asString } from './validation'
import type { AppContext } from './context'
import {
  SCHEMA_VERSION,
  backupDatabase,
  integrityCheck,
  openDatabase,
  replaceDatabaseFile
} from './data/database'

function requireNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildDashboard(ctx: AppContext): DashboardSnapshot {
  const info = ctx.networkInfo.getLastCached()
  const counts = ctx.devices.counts()
  const lastTraffic = ctx.trafficMonitor.getLastSnapshot()
  const traffic =
    lastTraffic ?? {
      timestamp: Date.now(),
      rxRate: 0,
      txRate: 0,
      rxTotal: 0,
      txTotal: 0,
      interfaces: [],
      source: 'en attente'
    }
  return {
    network:
      info ?? {
        hostname: '',
        localIp: null,
        mac: null,
        gateway: null,
        dns: [],
        publicIp: null,
        publicIpEnabled: false,
        interfaces: [],
        connectionType: 'unknown',
        ssid: null,
        subnet: null,
        updatedAt: 0
      },
    status: ctx.connectivity.getStatus(),
    counts,
    traffic,
    latency: ctx.connectivity.getLatest(),
    alerts: ctx.alerts.list({ limit: 8 }),
    unreadAlerts: ctx.alerts.unreadCount(),
    lastScan: ctx.scans.last(),
    deviceTypes: ctx.devices.typeDistribution(),
    trafficHistory: ctx.trafficMonitor.getHistory().slice(-120),
    uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
    monitorEnabled: ctx.settings.get().monitoring.enabled
  }
}

export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const handle = <T>(channel: string, fn: (payload: unknown) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const frame = event.senderFrame
      const verdict = checkSender(
        {
          url: frame?.url ?? '',
          isMainFrame: frame !== null && frame === event.sender.mainFrame,
          webContentsId: event.sender.id
        },
        { expectedWebContentsId: getWindow()?.webContents.id ?? null, devServerUrl }
      )
      if (!verdict.ok) {
        ctx.logger.warn(`IPC ${channel} refusé : ${verdict.reason}`)
        throw new Error('Requête refusée')
      }
      try {
        return await fn(payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur interne'
        ctx.logger.warn(`IPC ${channel} : ${message}`)
        throw new Error(message)
      }
    })
  }

  const appVersion =
    process.env.npm_package_version ?? (app.isPackaged ? app.getVersion() : '1.0.0')

  handle(IPC.appInfo, () => ({
    version: appVersion,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    databasePath: ctx.paths.databasePath,
    dataDirectory: ctx.paths.dataDir,
    ouiEntries: ctx.oui.size,
    uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
    osRelease: process.getSystemVersion?.() ?? ''
  }))

  handle(IPC.appOpenLogs, async () => {
    await shell.openPath(ctx.paths.logPath)
  })
  handle(IPC.appOpenData, async () => {
    await shell.openPath(ctx.paths.dataDir)
  })

  handle(IPC.appIntegrity, () => ({
    ...integrityCheck(ctx.db),
    path: ctx.paths.databasePath,
    schemaVersion: SCHEMA_VERSION
  }))

  handle(IPC.appBackup, async () => {
    const window = getWindow()
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const options = {
      title: 'Sauvegarder la base NetWatch',
      defaultPath: join(app.getPath('documents'), `netwatch-${stamp}.db`),
      filters: [{ name: 'Base NetWatch', extensions: ['db'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: null, bytes: 0 }
    }
    const bytes = await backupDatabase(ctx.db, result.filePath)
    ctx.logger.info('Sauvegarde de la base créée', { filePath: result.filePath, bytes })
    return { canceled: false, filePath: result.filePath, bytes }
  })

  handle(IPC.appRestore, async () => {
    const window = getWindow()
    const options = {
      title: 'Restaurer une sauvegarde NetWatch',
      properties: ['openFile' as const],
      filters: [{ name: 'Base NetWatch', extensions: ['db', 'sqlite', 'sqlite3'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, restored: false, message: '' }
    }
    const source = result.filePaths[0]
    const probe = openDatabase(source, { readonly: true, recoverCorrupt: false })
    let report
    try {
      report = integrityCheck(probe)
    } finally {
      probe.close()
    }
    if (!report.ok) {
      throw new Error(`Sauvegarde invalide : ${report.messages.join('; ')}`)
    }

    ctx.logger.info('Restauration de la base demandée', { source: basename(source) })
    ctx.close()
    replaceDatabaseFile(source, ctx.paths.databasePath)
    setImmediate(() => {
      app.relaunch()
      app.exit(0)
    })
    return { canceled: false, restored: true, message: 'Restauration effectuée, redémarrage…' }
  })

  handle(IPC.windowMinimize, () => {
    getWindow()?.minimize()
  })
  handle(IPC.windowToggleMaximize, () => {
    const window = getWindow()
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  handle(IPC.windowClose, () => {
    getWindow()?.close()
  })
  handle(IPC.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)

  handle(IPC.settingsGet, () => ctx.settings.get())
  handle(IPC.settingsUpdate, (payload) => ctx.settings.update(payload))
  handle(IPC.settingsReset, () => ctx.settings.reset())
  handle(IPC.settingsProfiles, () => ctx.settings.profiles())
  handle(IPC.settingsApplyProfile, (payload) => {
    const id = typeof payload === 'string' ? payload : ''
    return ctx.settings.applyProfile(id)
  })
  handle(IPC.settingsSaveProfile, (payload) => {
    const input = (payload ?? {}) as { name?: string; description?: string; overrides?: Record<string, unknown> }
    ctx.settings.saveProfile({
      name: typeof input.name === 'string' ? input.name : 'Profil',
      description: typeof input.description === 'string' ? input.description : '',
      overrides: (input.overrides ?? {}) as never
    })
    return ctx.settings.profiles()
  })
  handle(IPC.settingsDeleteProfile, (payload) => {
    const id = typeof payload === 'string' ? payload : ''
    ctx.settings.deleteProfile(id)
    return ctx.settings.profiles()
  })

  handle(IPC.dashboard, async () => {
    await ctx.networkInfo.get().catch(() => null)
    return buildDashboard(ctx)
  })
  handle(IPC.networkInfo, () => ctx.networkInfo.get())
  handle(IPC.networkRefresh, async () => {
    ctx.networkInfo.invalidate()
    return ctx.networkInfo.refresh()
  })
  handle(IPC.networkInterfaces, () => ctx.diagnostics.interfaces())

  handle(IPC.trafficSnapshot, () => ctx.trafficMonitor.sample())
  handle(IPC.trafficSeries, (payload) => {
    const period = (typeof payload === 'string' ? payload : '5m') as TrafficPeriod
    return ctx.trafficMonitor.series(periodConfig(period) ? period : '5m')
  })

  handle(IPC.scanStart, async (payload) => {
    const raw = (payload ?? {}) as ScanOptions
    const range = raw.range === undefined || raw.range === 'auto' ? undefined : asHost(raw.range)
    if (raw.range && raw.range !== 'auto' && !range) {
      throw new Error('Plage invalide : utilisez une adresse privée au format 192.168.1.0/24')
    }
    const options: ScanOptions = {
      range,
      trigger: asEnum(raw.trigger, ['manual', 'auto', 'startup'] as const, 'manual'),
      resolveHostnames: raw.resolveHostnames !== false,
      probePorts: raw.probePorts !== false
    }
    const settings = ctx.settings.get()
    try {
      const summary = await ctx.scanner.scan(options)
      ctx.emit('live:scan-done', summary)
      if (settings.alerts.deviceOffline) {
        ctx.alertEngine.checkOfflineDevices(ctx.devices.listAll())
      }
      ctx.emit('live:devices', ctx.devices.list({ limit: 1000 }))
      return summary
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec du scan'
      if (!message.includes('annulé')) ctx.alertEngine.onScanError(message)
      throw new Error(message)
    }
  })
  handle(IPC.scanCancel, () => {
    ctx.scanner.cancel()
    return true
  })
  handle(IPC.scanStatus, () => ctx.scanner.getProgress())
  handle(IPC.scanHistory, (payload) => ctx.scans.recent(requireNumber(payload, 20) || 20))
  handle(IPC.scanCompare, (): ScanComparison => {
    const current = ctx.scans.last(0)
    const previous = ctx.scans.last(1)
    if (!current || !previous) {
      return { previous, current, appeared: [], disappeared: [], unchanged: 0 }
    }
    const currentIds = new Set(ctx.scans.deviceIdsForScan(current.id))
    const previousIds = new Set(ctx.scans.deviceIdsForScan(previous.id))
    const appeared = [...currentIds]
      .filter((id) => !previousIds.has(id))
      .map((id) => ctx.devices.get(id))
      .filter((device): device is NonNullable<typeof device> => device !== null)
    const disappeared = [...previousIds]
      .filter((id) => !currentIds.has(id))
      .map((id) => ctx.devices.get(id))
      .filter((device): device is NonNullable<typeof device> => device !== null)
    const unchanged = [...currentIds].filter((id) => previousIds.has(id)).length
    return { previous, current, appeared, disappeared, unchanged }
  })

  handle(IPC.devicesList, (payload) => {
    const query = (payload ?? {}) as DeviceListQuery
    return ctx.devices.list({
      search: query.search,
      status: query.status ?? 'all',
      type: (query.type as never) ?? 'all',
      approved: query.approved ?? 'all',
      newOnly: query.newOnly,
      limit: query.limit ?? 1000,
      offset: query.offset ?? 0
    })
  })
  handle(IPC.deviceDetail, (payload): DeviceDetail | null => {
    const id = requireNumber(payload)
    const device = ctx.devices.get(id)
    if (!device) return null
    return {
      device,
      presence: ctx.devices.presence(id, 60),
      recentAlerts: ctx.alerts.list({ limit: 10 }).filter((alert) => alert.deviceId === id),
      firstSeenScanId: ctx.scans.firstScanForDevice(id)
    }
  })
  handle(IPC.deviceUpdate, (payload) => {
    const patch = (payload ?? {}) as DevicePatch
    const id = requireNumber(patch.id)
    const updated = ctx.devices.patch(id, {
      customName: patch.customName === undefined ? undefined : patch.customName,
      description: patch.description === undefined ? undefined : patch.description,
      tags: patch.tags,
      approved: patch.approved,
      deviceType: patch.deviceType
    })
    ctx.emit('live:devices', ctx.devices.list({ limit: 1000 }))
    return updated
  })
  handle(IPC.deviceRemove, (payload) => {
    const id = requireNumber(payload)
    if (id <= 0) return false
    ctx.devices.remove(id)
    ctx.emit('live:devices', ctx.devices.list({ limit: 1000 }))
    return true
  })

  handle(IPC.alertsList, (payload) => {
    const query = (payload ?? {}) as AlertListQuery
    return ctx.alerts.list({
      limit: query.limit ?? 200,
      offset: query.offset ?? 0,
      severity: query.severity ?? 'all',
      unreadOnly: query.unreadOnly,
      from: query.from,
      to: query.to
    })
  })
  handle(IPC.alertsMarkRead, (payload) => {
    ctx.alerts.markRead(requireNumber(payload))
    return true
  })
  handle(IPC.alertsMarkAllRead, () => {
    ctx.alerts.markAllRead()
    return true
  })
  handle(IPC.alertsClear, () => {
    ctx.alerts.clearAll()
    return true
  })

  handle(IPC.connections, () => ctx.connections.snapshot())

  handle(IPC.history, (payload): HistoryPage => {
    const raw = (payload ?? {}) as HistoryQuery
    const query: HistoryQuery = {
      ...raw,
      from: raw.from === undefined ? undefined : asInt(raw.from, 0, Number.MAX_SAFE_INTEGER, 0),
      to: raw.to === undefined ? undefined : asInt(raw.to, 0, Number.MAX_SAFE_INTEGER, Date.now()),
      limit: asInt(raw.limit, 1, 2000, 200),
      categories: Array.isArray(raw.categories)
        ? raw.categories.filter((c): c is EventCategory => typeof c === 'string').slice(0, 12)
        : undefined,
      search: asString(raw.search, 120) || undefined
    }
    return {
      events: ctx.events.list(query),
      total: ctx.events.count(query)
    }
  })

  handle(IPC.diagnosticsRun, () => ctx.diagnostics.runAll())
  handle(IPC.diagnosticsRunOne, (payload) => ctx.diagnostics.runOne(typeof payload === 'string' ? payload : ''))
  handle(IPC.diagnosticsLast, () => ctx.diagnostics.getLastReport())
  handle(IPC.diagnosticsTraceroute, (payload) =>
    ctx.diagnostics.traceroute(asHost(payload))
  )

  handle(IPC.exportData, async (payload): Promise<ExportResult> => {
    const request = (payload ?? {}) as { dataset?: string; format?: 'csv' | 'json'; from?: number; to?: number; suggestedName?: string }
    const settings: Settings = ctx.settings.get()
    const dataset = asEnum(
      request.dataset,
      ['devices', 'alerts', 'events', 'traffic', 'latency', 'scans', 'diagnostics'] as const,
      'devices'
    ) as never
    const format = asEnum(request.format, ['csv', 'json'] as const, settings.export.defaultFormat)
    const built = await ctx.exporter.build({
      dataset,
      format,
      from: request.from,
      to: request.to,
      suggestedName: request.suggestedName
    })
    const window = getWindow()
    const options = {
      title: 'Exporter les données',
      defaultPath: join(app.getPath('downloads'), built.fileName),
      filters:
        format === 'csv'
          ? [{ name: 'Fichier CSV', extensions: ['csv'] }]
          : [{ name: 'Fichier JSON', extensions: ['json'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: null, rows: 0, bytes: 0 }
    }
    try {
      writeFileSync(result.filePath, built.content, 'utf8')
      return {
        canceled: false,
        filePath: result.filePath,
        rows: built.rows,
        bytes: Buffer.byteLength(built.content, 'utf8')
      }
    } catch (error) {
      ctx.logger.error('Écriture du fichier exporté impossible', error)
      throw new Error("Impossible d'écrire le fichier d'export")
    }
  })

  handle(IPC.dataStats, (): DataStats => {
    const count = (sql: string): number => {
      const row = ctx.db.prepare(sql).get() as { c: number } | undefined
      return row?.c ?? 0
    }
    let size = 0
    try {
      size = statSync(ctx.paths.databasePath).size
    } catch {
      size = 0
    }
    const oldest = ctx.db.prepare('SELECT MIN(created_at) AS t FROM events').get() as
      | { t: number | null }
      | undefined
    return {
      devices: count('SELECT COUNT(*) AS c FROM devices'),
      onlineDevices: count("SELECT COUNT(*) AS c FROM devices WHERE status = 'online'"),
      alerts: count('SELECT COUNT(*) AS c FROM alerts'),
      events: count('SELECT COUNT(*) AS c FROM events'),
      scans: count('SELECT COUNT(*) AS c FROM scans'),
      trafficRows: count('SELECT COUNT(*) AS c FROM traffic_minutes'),
      latencySamples: count('SELECT COUNT(*) AS c FROM latency_samples'),
      databaseSizeBytes: size,
      databasePath: ctx.paths.databasePath,
      oldestEventAt: oldest?.t ?? null
    }
  })

  handle(IPC.dataPurge, (payload) => {
    const days = Math.max(1, Math.min(3650, requireNumber(payload, 30) || 30))
    const cutoff = Date.now() - days * 24 * 60 * 60_000
    let removed = 0
    removed += ctx.events.deleteOlderThan(cutoff)
    removed += ctx.alerts.deleteOlderThan(cutoff)
    removed += ctx.scans.deleteOlderThan(cutoff)
    removed += ctx.trafficRepo.deleteOlderThan(cutoff)
    removed += ctx.latencyRepo.deleteOlderThan(cutoff)
    ctx.logger.info(`Purge de l’historique : ${removed} enregistrements supprimés (${days} jours)`)
    return removed
  })

  handle(IPC.dataReset, () => {
    ctx.devices.clearAll()
    ctx.alerts.clearAll()
    ctx.events.clearAll()
    ctx.trafficRepo.clearAll()
    ctx.latencyRepo.clearAll()
    ctx.diagnosticsRepo.clearAll()
    ctx.db.exec('DELETE FROM scans; DELETE FROM scan_devices;')
    ctx.emit('live:devices', [])
    ctx.logger.info('Réinitialisation complète des données')
    return true
  })
}
