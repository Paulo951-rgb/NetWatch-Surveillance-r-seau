import type { HopResult } from '@shared/types'
import { runCommand } from './exec'
import { resolveDnsName } from './dns'
import { isSafeHost, clampInt } from './validate'
import {
  parseArpWindows,
  parseNetAdapterStatistics,
  parseNetIpConfiguration,
  parseNetshDns,
  parseNetshWifiSsid,
  parseNetstatE,
  parseNetstatWindows,
  parsePowerShellJson,
  parseProcessJson,
  parseRoutePrintDefault,
  parseTasklistCsv
} from './parsers/windows'
import { parsePingOutput, parseTracerouteOutput } from './parsers/ping'
import type {
  ArpEntry,
  CommandRunner,
  CountersResult,
  DnsTestResult,
  PingResult,
  PlatformAdapter,
  RawConnection,
  RouteInfo
} from './types'

const PS = 'powershell.exe'
const PS_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
const PS_UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'

const SCRIPT_NET_CONFIG =
  PS_UTF8 +
  '@(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | ' +
  'Select-Object InterfaceAlias,@{n="IPv4";e={$_.IPv4Address.IPAddress}},@{n="Gateway";e={$_.IPv4DefaultGateway.NextHop}},@{n="Dns";e={@($_.DNSServer.ServerAddresses)}}) ' +
  '| ConvertTo-Json -Compress -Depth 4'

const SCRIPT_ADAPTER_STATS =
  PS_UTF8 + '@(Get-NetAdapterStatistics) | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'

function buildProcessScript(pids: number[]): string {
  const ids = pids.map((pid) => Math.trunc(pid)).filter((pid) => pid > 0)
  return (
    PS_UTF8 +
    `@(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName) | ConvertTo-Json -Compress`
  )
}

export function createWindowsAdapter(run: CommandRunner = runCommand): PlatformAdapter {
  const powershell = (script: string, timeoutMs = 8000) =>
    run(PS, [...PS_FLAGS, script], { timeoutMs })

  async function getRouteInfo(): Promise<RouteInfo> {
    const psResult = await powershell(SCRIPT_NET_CONFIG, 10000)
    if (psResult.code === 0) {
      const configs = parseNetIpConfiguration(psResult.stdout)
      if (configs.length > 0) {
        const config = configs.find((entry) => entry.gateway) ?? configs[0]
        return {
          gateway: config.gateway,
          localIp: config.ipv4,
          dns: config.dns,
          interfaceName: config.interfaceAlias || null,
          source: 'Get-NetIPConfiguration'
        }
      }
    }

    const route = await run('route', ['print', '-4', '0.0.0.0'], { timeoutMs: 8000 })
    const parsed = parseRoutePrintDefault(route.stdout)
    const dnsResult = await run('netsh', ['interface', 'ip', 'show', 'dnsservers'], { timeoutMs: 6000 })
    return {
      gateway: parsed?.gateway ?? null,
      localIp: parsed?.localIp ?? null,
      dns: parseNetshDns(dnsResult.stdout),
      interfaceName: null,
      source: parsed ? 'route print' : 'indisponible'
    }
  }

  async function getArpTable(): Promise<ArpEntry[]> {
    const result = await run('arp', ['-a'], { timeoutMs: 8000 })
    return parseArpWindows(result.stdout)
  }

  async function getConnections(): Promise<RawConnection[]> {
    const result = await run('netstat', ['-ano'], { timeoutMs: 20000 })
    return parseNetstatWindows(result.stdout)
  }

  async function getProcessNames(pids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    const unique = [...new Set(pids.filter((pid) => Number.isFinite(pid) && pid > 0))]
    for (let i = 0; i < unique.length; i += 60) {
      const chunk = unique.slice(i, i + 60)
      const psResult = await powershell(buildProcessScript(chunk), 8000)
      if (psResult.code === 0) {
        for (const [pid, name] of parseProcessJson(psResult.stdout)) {
          if (chunk.includes(pid)) map.set(pid, name)
        }
      }
    }
    if (map.size < unique.length) {
      const missing = unique.filter((pid) => !map.has(pid))
      if (missing.length > 0) {
        const tasklist = await run('tasklist', ['/fo', 'csv', '/nh'], { timeoutMs: 12000 })
        const fallback = parseTasklistCsv(tasklist.stdout)
        for (const pid of missing) {
          const name = fallback.get(pid)
          if (name) map.set(pid, name)
        }
      }
    }
    return map
  }

  async function getInterfaceCounters(): Promise<CountersResult> {
    const psResult = await powershell(SCRIPT_ADAPTER_STATS, 10000)
    if (psResult.code === 0) {
      const counters = parseNetAdapterStatistics(psResult.stdout)
      if (counters.length > 0) return { counters, source: 'Get-NetAdapterStatistics' }
    }
    const fallback = await run('netstat', ['-e'], { timeoutMs: 8000 })
    const totals = parseNetstatE(fallback.stdout)
    if (totals) {
      return {
        counters: [{ name: 'Total système', rxBytes: totals.rxBytes, txBytes: totals.txBytes }],
        source: 'netstat -e'
      }
    }
    return { counters: [], source: 'indisponible' }
  }

  async function ping(host: string, options?: { count?: number; timeoutMs?: number }): Promise<PingResult> {
    if (!isSafeHost(host)) {
      return {
        host,
        sent: 0,
        received: 0,
        lossPercent: 100,
        rttMs: null,
        minMs: null,
        maxMs: null,
        times: [],
        available: false,
        error: 'Hôte invalide'
      }
    }
    const count = clampInt(options?.count ?? 1, 1, 20, 1)
    const timeoutMs = clampInt(options?.timeoutMs ?? 900, 100, 5000, 900)
    const result = await run('ping', ['-n', String(count), '-w', String(timeoutMs), '-4', host], {
      timeoutMs: count * timeoutMs + 4000
    })
    const parsed = parsePingOutput(result.stdout, host, count)
    if (result.code !== 0 && parsed.received === 0) {
      return { ...parsed, error: parsed.error ?? result.error ?? 'Échec du ping' }
    }
    return parsed
  }

  async function traceroute(host: string, options?: { maxHops?: number; timeoutMs?: number }): Promise<HopResult[]> {
    if (!isSafeHost(host)) return []
    const maxHops = clampInt(options?.maxHops ?? 20, 1, 30, 20)
    const timeoutMs = clampInt(options?.timeoutMs ?? 800, 100, 3000, 800)
    const result = await run(
      'tracert',
      ['-d', '-h', String(maxHops), '-w', String(timeoutMs), host],
      { timeoutMs: maxHops * timeoutMs * 2 + 8000 }
    )
    return parseTracerouteOutput(result.stdout)
  }

  async function resolveDns(name: string): Promise<DnsTestResult> {
    if (!isSafeHost(name)) {
      return { ok: false, name, addresses: [], durationMs: 0, error: 'Nom invalide' }
    }
    return resolveDnsName(name)
  }

  async function getWifiSsid(): Promise<string | null> {
    const result = await run('netsh', ['wlan', 'show', 'interfaces'], { timeoutMs: 6000 })
    if (result.code !== 0) return null
    return parseNetshWifiSsid(result.stdout)
  }

  return {
    platform: 'win32',
    label: 'Windows',
    getRouteInfo,
    getArpTable,
    getConnections,
    getProcessNames,
    getInterfaceCounters,
    ping,
    traceroute,
    resolveDns,
    getWifiSsid
  }
}

/** Exposé pour les tests : analyse d'une sortie PowerShell quelconque. */
export { parsePowerShellJson }
