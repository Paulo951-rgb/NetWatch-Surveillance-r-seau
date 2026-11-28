import type {
  Alert,
  AppInfo,
  BackupResult,
  DatabaseIntegrity,
  ConnectionSnapshot,
  DashboardSnapshot,
  Device,
  DeviceDetail,
  DevicePatch,
  DiagnosticReport,
  DiagnosticResult,
  ExportRequest,
  ExportResult,
  HistoryPage,
  HistoryQuery,
  LatencySnapshot,
  MonitoringProfile,
  NetworkInfo,
  NetworkInterfaceInfo,
  RestoreResult,
  ScanComparison,
  ScanOptions,
  ScanProgress,
  ScanSummary,
  Settings,
  TrafficPeriod,
  TrafficSeries,
  TrafficSnapshot,
  TracerouteResult
} from './types'

export const IPC = {
  appInfo: 'app:info',
  appOpenLogs: 'app:open-logs',
  appOpenData: 'app:open-data',
  appIntegrity: 'app:integrity',
  appBackup: 'app:backup',
  appRestore: 'app:restore',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  settingsProfiles: 'settings:profiles',
  settingsApplyProfile: 'settings:apply-profile',
  settingsSaveProfile: 'settings:save-profile',
  settingsDeleteProfile: 'settings:delete-profile',

  dashboard: 'dashboard:get',
  networkInfo: 'network:info',
  networkRefresh: 'network:refresh',
  networkInterfaces: 'network:interfaces',

  trafficSnapshot: 'traffic:snapshot',
  trafficSeries: 'traffic:series',

  scanStart: 'scan:start',
  scanCancel: 'scan:cancel',
  scanStatus: 'scan:status',
  scanHistory: 'scan:history',
  scanCompare: 'scan:compare',

  devicesList: 'devices:list',
  deviceDetail: 'devices:detail',
  deviceUpdate: 'devices:update',
  deviceRemove: 'devices:remove',

  alertsList: 'alerts:list',
  alertsMarkRead: 'alerts:mark-read',
  alertsMarkAllRead: 'alerts:mark-all-read',
  alertsClear: 'alerts:clear',

  connections: 'connections:snapshot',

  history: 'history:list',

  diagnosticsRun: 'diagnostics:run',
  diagnosticsRunOne: 'diagnostics:run-one',
  diagnosticsLast: 'diagnostics:last',
  diagnosticsTraceroute: 'diagnostics:traceroute',

  exportData: 'export:data',
  dataStats: 'data:stats',
  dataPurge: 'data:purge',
  dataReset: 'data:reset'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface DataStats {
  devices: number
  onlineDevices: number
  alerts: number
  events: number
  scans: number
  trafficRows: number
  latencySamples: number
  databaseSizeBytes: number
  databasePath: string
  oldestEventAt: number | null
}

export interface DeviceListQuery {
  search?: string
  status?: 'online' | 'offline' | 'all'
  type?: string
  approved?: 'all' | 'yes' | 'no'
  newOnly?: boolean
  limit?: number
  offset?: number
}

export interface AlertListQuery {
  limit?: number
  offset?: number
  severity?: 'info' | 'warning' | 'critical' | 'all'
  unreadOnly?: boolean
  from?: number
  to?: number
}

/** API exposée à l'interface par le preload (contexte isolé). */
export interface NetWatchApi {
  getAppInfo(): Promise<AppInfo>
  openLogs(): Promise<void>
  openDataFolder(): Promise<void>
  checkDatabase(): Promise<DatabaseIntegrity>
  backupDatabase(): Promise<BackupResult>
  restoreDatabase(): Promise<RestoreResult>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>

  getSettings(): Promise<Settings>
  updateSettings(patch: unknown): Promise<Settings>
  resetSettings(): Promise<Settings>
  getProfiles(): Promise<MonitoringProfile[]>
  applyProfile(id: string): Promise<Settings>
  saveProfile(input: { name: string; description: string; overrides: MonitoringProfile['overrides'] }): Promise<MonitoringProfile[]>
  deleteProfile(id: string): Promise<MonitoringProfile[]>

  getDashboard(): Promise<DashboardSnapshot>
  getNetworkInfo(): Promise<NetworkInfo>
  refreshNetworkInfo(): Promise<NetworkInfo>
  getNetworkInterfaces(): Promise<NetworkInterfaceInfo[]>

  getTrafficSnapshot(): Promise<TrafficSnapshot>
  getTrafficSeries(period: TrafficPeriod): Promise<TrafficSeries>

  startScan(options?: ScanOptions): Promise<ScanSummary>
  cancelScan(): Promise<boolean>
  getScanStatus(): Promise<ScanProgress>
  getScanHistory(limit?: number): Promise<ScanSummary[]>
  compareScans(): Promise<ScanComparison>

  listDevices(query?: DeviceListQuery): Promise<Device[]>
  getDeviceDetail(id: number): Promise<DeviceDetail | null>
  updateDevice(patch: DevicePatch): Promise<Device | null>
  removeDevice(id: number): Promise<boolean>

  listAlerts(query?: AlertListQuery): Promise<Alert[]>
  markAlertRead(id: number): Promise<boolean>
  markAllAlertsRead(): Promise<boolean>
  clearAlerts(): Promise<boolean>

  getConnections(): Promise<ConnectionSnapshot>

  getHistory(query?: HistoryQuery): Promise<HistoryPage>

  runDiagnostics(): Promise<DiagnosticReport>
  runDiagnostic(key: string): Promise<DiagnosticResult>
  getLastDiagnostics(): Promise<DiagnosticReport | null>
  runTraceroute(target?: string): Promise<TracerouteResult>

  exportData(request: ExportRequest): Promise<ExportResult>
  getDataStats(): Promise<DataStats>
  purgeData(days: number): Promise<number>
  resetData(): Promise<boolean>

  onTraffic(callback: (payload: TrafficSnapshot) => void): () => void
  onStatus(callback: (payload: import('./types').ConnectivityStatus) => void): () => void
  onLatency(callback: (payload: LatencySnapshot) => void): () => void
  onScanProgress(callback: (payload: ScanProgress) => void): () => void
  onScanDone(callback: (payload: ScanSummary) => void): () => void
  onAlert(callback: (payload: Alert) => void): () => void
  onDevices(callback: (payload: Device[]) => void): () => void
  onConnections(callback: (payload: ConnectionSnapshot) => void): () => void
  onSettings(callback: (payload: Settings) => void): () => void
  onNavigate(callback: (path: string) => void): () => void
  onWindowMaximized(callback: (maximized: boolean) => void): () => void
}

export const LIVE_CHANNELS = {
  traffic: 'live:traffic',
  status: 'live:status',
  latency: 'live:latency',
  scanProgress: 'live:scan-progress',
  scanDone: 'live:scan-done',
  alert: 'live:alert',
  devices: 'live:devices',
  connections: 'live:connections',
  settings: 'live:settings',
  navigate: 'app:navigate',
  windowMaximized: 'window:maximized'
} as const
