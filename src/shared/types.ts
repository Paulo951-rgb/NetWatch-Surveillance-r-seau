/**
 * Contrats de données partagés entre le processus principal, le preload
 * et l'interface. Aucun de ces types ne dépend d'Electron : ils sont
 * utilisables dans les tests unitaires.
 */

export type DeviceType =
  | 'computer'
  | 'smartphone'
  | 'tablet'
  | 'printer'
  | 'router'
  | 'tv'
  | 'console'
  | 'iot'
  | 'nas'
  | 'camera'
  | 'speaker'
  | 'unknown'

export type DeviceStatus = 'online' | 'offline'

export interface NetworkInterfaceInfo {
  name: string
  address: string
  netmask: string
  cidr: string | null
  mac: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
  virtual: boolean
}

export interface NetworkInfo {
  hostname: string
  localIp: string | null
  mac: string | null
  gateway: string | null
  dns: string[]
  publicIp: string | null
  publicIpEnabled: boolean
  interfaces: NetworkInterfaceInfo[]
  connectionType: 'ethernet' | 'wifi' | 'unknown'
  ssid: string | null
  subnet: string | null
  updatedAt: number
}

export interface ConnectivityStatus {
  internet: boolean
  gateway: boolean
  dns: boolean
  latencyMs: number | null
  gatewayLatencyMs: number | null
  jitterMs: number | null
  packetLoss: number | null
  lastCheck: number
  checking: boolean
}

export interface InterfaceTraffic {
  name: string
  rxRate: number
  txRate: number
  rxTotal: number
  txTotal: number
}

export interface TrafficSnapshot {
  timestamp: number
  rxRate: number
  txRate: number
  rxTotal: number
  txTotal: number
  interfaces: InterfaceTraffic[]
  source: string
}

export interface TrafficPoint {
  t: number
  rx: number
  tx: number
}

export type TrafficPeriod = '1m' | '5m' | '30m' | '1h' | '24h' | '7d'

export interface TrafficSeries {
  period: TrafficPeriod
  bucketMs: number
  points: TrafficPoint[]
  rxTotal: number
  txTotal: number
  peakRx: number
  peakTx: number
  avgRx: number
  avgTx: number
  live: boolean
}

export interface Device {
  id: number
  key: string
  ip: string | null
  mac: string | null
  vendor: string | null
  hostname: string | null
  deviceType: DeviceType
  status: DeviceStatus
  firstSeen: number
  lastSeen: number
  lastStatusChange: number
  customName: string | null
  description: string | null
  tags: string[]
  approved: boolean
  isNew: boolean
  isLocalHost: boolean
  isGateway: boolean
  presenceCount: number
  openPorts: number[]
}

export interface PresenceEntry {
  id: number
  deviceId: number
  status: DeviceStatus
  ip: string | null
  changedAt: number
}

export interface DeviceDetail {
  device: Device
  presence: PresenceEntry[]
  recentAlerts: Alert[]
  firstSeenScanId: number | null
}

export interface DevicePatch {
  id: number
  customName?: string | null
  description?: string | null
  tags?: string[]
  approved?: boolean
  deviceType?: DeviceType
}

export type ScanPhase = 'idle' | 'discovering' | 'probing' | 'resolving' | 'saving' | 'done' | 'error'

export interface ScanProgress {
  scanId: number
  phase: ScanPhase
  processed: number
  total: number
  found: number
  currentIp: string | null
  message: string | null
  startedAt: number
  error: string | null
}

export interface ScanSummary {
  id: number
  startedAt: number
  finishedAt: number | null
  range: string
  trigger: 'manual' | 'auto' | 'startup'
  found: number
  newDevices: number
  offlineDevices: number
  durationMs: number
  error: string | null
}

export interface ScanComparison {
  previous: ScanSummary | null
  current: ScanSummary | null
  appeared: Device[]
  disappeared: Device[]
  unchanged: number
}

export type Protocol = 'TCP' | 'UDP'

export interface Connection {
  protocol: Protocol
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number | null
  processName: string | null
  direction: 'inbound' | 'outbound' | 'listening' | 'local'
}

export interface ConnectionSnapshot {
  timestamp: number
  connections: Connection[]
  counts: {
    total: number
    tcp: number
    udp: number
    established: number
    listening: number
  }
  topProcesses: { name: string; connections: number }[]
}

export type AlertType =
  | 'new-device'
  | 'unknown-device'
  | 'device-offline'
  | 'device-online'
  | 'internet-lost'
  | 'internet-restored'
  | 'high-latency'
  | 'high-traffic'
  | 'local-ip-changed'
  | 'gateway-changed'
  | 'dns-failure'
  | 'scan-error'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface Alert {
  id: number
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  deviceId: number | null
  deviceName: string | null
  createdAt: number
  read: boolean
}

export type EventCategory = 'device' | 'alert' | 'traffic' | 'network' | 'scan' | 'system'

export interface HistoryEvent {
  id: number
  category: EventCategory
  type: string
  message: string
  deviceId: number | null
  deviceName: string | null
  createdAt: number
  meta: Record<string, unknown> | null
}

export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'skipped' | 'running'

export interface DiagnosticMetric {
  label: string
  value: string
}

export interface DiagnosticResult {
  key: string
  label: string
  status: DiagnosticStatus
  summary: string
  detail: string | null
  explanation: string | null
  metrics: DiagnosticMetric[]
  durationMs: number
}

export interface DiagnosticReport {
  startedAt: number
  finishedAt: number
  results: DiagnosticResult[]
  score: number
  problemCount: number
  warningCount: number
}

export interface HopResult {
  hop: number
  host: string | null
  rttMs: number | null
}

export interface TracerouteResult {
  target: string
  hops: HopResult[]
  reached: boolean
  durationMs: number
  error: string | null
}

export interface LatencySnapshot {
  timestamp: number
  gatewayMs: number | null
  internetMs: number | null
  jitterMs: number | null
  lossPercent: number | null
}

export interface DashboardSnapshot {
  network: NetworkInfo
  status: ConnectivityStatus
  counts: {
    total: number
    online: number
    offline: number
    newDevices: number
    unknownDevices: number
    approved: number
  }
  traffic: TrafficSnapshot
  latency: LatencySnapshot
  alerts: Alert[]
  unreadAlerts: number
  lastScan: ScanSummary | null
  deviceTypes: { type: DeviceType; count: number }[]
  trafficHistory: TrafficPoint[]
  uptimeSeconds: number
  monitorEnabled: boolean
}

export interface HistoryQuery {
  from?: number
  to?: number
  categories?: EventCategory[]
  search?: string
  limit?: number
  offset?: number
}

export interface HistoryPage {
  events: HistoryEvent[]
  total: number
}

export type ExportDataset = 'devices' | 'alerts' | 'events' | 'traffic' | 'connections' | 'diagnostics'

export interface ExportRequest {
  dataset: ExportDataset
  format?: 'csv' | 'json'
  from?: number
  to?: number
  suggestedName?: string
}

export interface ExportResult {
  canceled: boolean
  filePath: string | null
  rows: number
  bytes: number
}

export interface AppInfo {
  version: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
  arch: string
  isPackaged: boolean
  databasePath: string
  dataDirectory: string
  ouiEntries: number
  uptimeSeconds: number
  osRelease: string
}

export interface AlertThresholds {
  newDevice: boolean
  unknownDevice: boolean
  deviceOffline: boolean
  internetLost: boolean
  highLatency: boolean
  highTraffic: boolean
  localIpChanged: boolean
  dnsFailure: boolean
  highLatencyMs: number
  highTrafficMbps: number
  deviceOfflineMinutes: number
  cooldownMinutes: number
}

export interface Settings {
  theme: 'dark' | 'light'
  language: 'fr' | 'en'
  notifications: {
    enabled: boolean
    native: boolean
    minSeverity: AlertSeverity
  }
  scanning: {
    autoScan: boolean
    intervalMinutes: number
    range: string
    concurrency: number
    resolveHostnames: boolean
    probePorts: boolean
  }
  monitoring: {
    enabled: boolean
    refreshIntervalMs: number
    trafficIntervalMs: number
    latencyIntervalMs: number
    connectionsIntervalMs: number
    backgroundWhenMinimized: boolean
  }
  alerts: AlertThresholds
  retention: {
    days: number
    maxAlerts: number
  }
  startup: {
    launchAtLogin: boolean
    startMinimized: boolean
    minimizeToTray: boolean
  }
  privacy: {
    allowPublicIp: boolean
    allowExternalPing: boolean
  }
  advanced: {
    activeProfileId: string
    showExperimental: boolean
  }
  export: {
    defaultFormat: 'csv' | 'json'
    includeHeaders: boolean
  }
}

export interface MonitoringProfile {
  id: string
  name: string
  description: string
  builtin: boolean
  overrides: {
    scanning?: Partial<Settings['scanning']>
    monitoring?: Partial<Settings['monitoring']>
    alerts?: Partial<AlertThresholds>
  }
}

export interface SettingsPatch {
  [key: string]: unknown
}

export interface ScanOptions {
  range?: string
  trigger?: 'manual' | 'auto' | 'startup'
  resolveHostnames?: boolean
  probePorts?: boolean
}

export interface LiveEventMap {
  'live:traffic': TrafficSnapshot
  'live:status': ConnectivityStatus
  'live:latency': LatencySnapshot
  'live:scan-progress': ScanProgress
  'live:scan-done': ScanSummary
  'live:alert': Alert
  'live:devices': Device[]
  'live:connections': ConnectionSnapshot
  'live:settings': Settings
  'app:navigate': string
}
