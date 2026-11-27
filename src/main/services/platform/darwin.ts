import os from 'node:os'
import type { HopResult } from '@shared/types'
import { isValidIPv4 } from '@shared/iputil'
import { runCommand } from './exec'
import { resolveDnsName } from './dns'
import { clampInt, isSafeHost } from './validate'
import {
  parseArpBsd,
  parseMacRouteDefault,
  parseNetstatBsd,
  parseNetstatIBN,
  parseScutilDns
} from './parsers/unix'
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

function ipv4ForInterface(name: string): string | null {
  const entries = os.networkInterfaces()[name]
  const found = (entries ?? []).find((entry) => entry.family === 'IPv4' && !entry.internal)
  return found ? found.address : null
}

export function createDarwinAdapter(run: CommandRunner = runCommand): PlatformAdapter {
  async function getRouteInfo(): Promise<RouteInfo> {
    const route = await run('route', ['-n', 'get', 'default'], { timeoutMs: 5000 })
    const parsed = parseMacRouteDefault(route.stdout)
    const dnsResult = await run('scutil', ['--dns'], { timeoutMs: 5000 })
    const dns = parseScutilDns(dnsResult.stdout)
    return {
      gateway: parsed.gateway,
      localIp: parsed.iface ? ipv4ForInterface(parsed.iface) : null,
      dns,
      interfaceName: parsed.iface,
      source: parsed.gateway ? 'route get default' : 'indisponible'
    }
  }

  async function getArpTable(): Promise<ArpEntry[]> {
    const result = await run('arp', ['-an'], { timeoutMs: 6000 })
    return parseArpBsd(result.stdout)
  }

  async function getConnections(): Promise<RawConnection[]> {
    const tcp = await run('netstat', ['-anv', '-p', 'tcp'], { timeoutMs: 12000 })
    const udp = await run('netstat', ['-anv', '-p', 'udp'], { timeoutMs: 12000 })
    return [...parseNetstatBsd(tcp.stdout), ...parseNetstatBsd(udp.stdout)]
  }

  async function getProcessNames(pids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    const result = await run('ps', ['-Ao', 'pid=,comm='], { timeoutMs: 8000 })
    const wanted = new Set(pids.filter((pid) => Number.isFinite(pid) && pid > 0))
    for (const rawLine of result.stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(rawLine)
      if (!match) continue
      const pid = Number(match[1])
      if (!wanted.has(pid)) continue
      const name = match[2].split('/').pop() ?? match[2]
      map.set(pid, name.trim())
    }
    return map
  }

  async function getInterfaceCounters(): Promise<CountersResult> {
    const result = await run('netstat', ['-ibn'], { timeoutMs: 8000 })
    const counters = parseNetstatIBN(result.stdout)
    return { counters, source: 'netstat -ibn' }
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
    const waitMs = clampInt(options?.timeoutMs ?? 900, 100, 5000, 900)
    const result = await run('ping', ['-n', '-c', String(count), '-W', String(waitMs), host], {
      timeoutMs: count * waitMs + 5000
    })
    const parsed = parsePingOutput(result.stdout, host, count)
    return { ...parsed, error: parsed.received === 0 ? parsed.error ?? result.error : null }
  }

  async function traceroute(host: string, options?: { maxHops?: number; timeoutMs?: number }): Promise<HopResult[]> {
    if (!isSafeHost(host)) return []
    const maxHops = clampInt(options?.maxHops ?? 20, 1, 30, 20)
    const result = await run(
      'traceroute',
      ['-n', '-q', '1', '-w', '1', '-m', String(maxHops), host],
      { timeoutMs: maxHops * 2000 + 6000 }
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
    for (const iface of ['en0', 'en1']) {
      const result = await run('networksetup', ['-getairportnetwork', iface], { timeoutMs: 4000 })
      const match = /:\s*(.+)$/.exec(result.stdout.trim())
      if (result.code === 0 && match && !/not associated/i.test(result.stdout)) {
        return match[1].trim()
      }
    }
    return null
  }

  return {
    platform: 'darwin',
    label: 'macOS',
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

/** Utilisé pour valider la cohérence des adresses renvoyées par macOS. */
export function isUsableAddress(ip: string): boolean {
  return isValidIPv4(ip)
}
