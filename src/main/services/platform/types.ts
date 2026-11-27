import type { HopResult } from '@shared/types'

export interface CommandOptions {
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  /** Encodage de décodage de la sortie (utf8 par défaut). */
  encoding?: BufferEncoding
}

export interface CommandResult {
  stdout: string
  stderr: string
  code: number
  timedOut: boolean
  error: string | null
  durationMs: number
}

export type CommandRunner = (
  file: string,
  args: string[],
  options?: CommandOptions
) => Promise<CommandResult>

export interface ArpEntry {
  ip: string
  mac: string
  iface: string | null
}

export interface RawConnection {
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number | null
}

export interface InterfaceCounters {
  name: string
  rxBytes: number
  txBytes: number
}

export interface CountersResult {
  counters: InterfaceCounters[]
  source: string
}

export interface PingResult {
  host: string
  sent: number
  received: number
  lossPercent: number
  rttMs: number | null
  minMs: number | null
  maxMs: number | null
  times: number[]
  available: boolean
  error: string | null
  /** Méthode réellement utilisée pour la mesure. */
  method?: 'icmp' | 'tcp'
}

export interface RouteInfo {
  gateway: string | null
  localIp: string | null
  dns: string[]
  interfaceName: string | null
  source: string
}

export interface DnsTestResult {
  ok: boolean
  name: string
  addresses: string[]
  durationMs: number
  error: string | null
}

export interface PlatformAdapter {
  readonly platform: NodeJS.Platform
  readonly label: string
  getRouteInfo(): Promise<RouteInfo>
  getArpTable(): Promise<ArpEntry[]>
  getConnections(): Promise<RawConnection[]>
  getProcessNames(pids: number[]): Promise<Map<number, string>>
  getInterfaceCounters(): Promise<CountersResult>
  ping(host: string, options?: { count?: number; timeoutMs?: number }): Promise<PingResult>
  traceroute(host: string, options?: { maxHops?: number; timeoutMs?: number }): Promise<HopResult[]>
  resolveDns(name: string): Promise<DnsTestResult>
  getWifiSsid(): Promise<string | null>
}
