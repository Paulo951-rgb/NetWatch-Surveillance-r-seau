import { promises as fs } from 'node:fs'
import os from 'node:os'
import type { HopResult } from '@shared/types'
import { isValidIPv4 } from '@shared/iputil'
import { runCommand } from './exec'
import { resolveDnsName } from './dns'
import { parseProcNet, type ProcNetEntry } from './parsers/procnet'
import { tcpLatencyPing } from './tcp-ping'
import { clampInt, isSafeHost } from './validate'
import {
  parseArpBsd,
  parseIpNeigh,
  parseIpRouteDefault,
  parseProcNetDev,
  parseResolvConf,
  parseSsOutput
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

function firstLocalIpv4(): string | null {
  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isValidIPv4(entry.address)) {
        return entry.address
      }
    }
  }
  return null
}

function ipv4ForInterface(name: string): string | null {
  const entries = os.networkInterfaces()[name]
  const found = (entries ?? []).find((entry) => entry.family === 'IPv4' && !entry.internal)
  return found ? found.address : null
}

export function createLinuxAdapter(run: CommandRunner = runCommand): PlatformAdapter {
  async function getRouteInfo(): Promise<RouteInfo> {
    const route = await run('ip', ['route', 'show', 'default'], { timeoutMs: 5000 })
    let parsed = parseIpRouteDefault(route.stdout)
    let source = 'ip route'
    if (!parsed.gateway) {
      const legacy = await run('route', ['-n'], { timeoutMs: 5000 })
      const line = legacy.stdout.split('\n').find((value) => value.startsWith('0.0.0.0'))
      if (line) {
        const tokens = line.trim().split(/\s+/)
        parsed = {
          gateway: tokens[1] && isValidIPv4(tokens[1]) ? tokens[1] : null,
          iface: tokens[tokens.length - 1] ?? null,
          src: null
        }
        source = 'route -n'
      }
    }

    let dns: string[] = []
    try {
      dns = parseResolvConf(await fs.readFile('/etc/resolv.conf', 'utf8'))
    } catch {
      dns = []
    }
    if (dns.length === 0) {
      const resolvectl = await run('resolvectl', ['dns'], { timeoutMs: 4000 })
      dns = (resolvectl.stdout.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).filter((ip) =>
        isValidIPv4(ip)
      )
      dns = [...new Set(dns)]
    }

    const localIp =
      (parsed.iface ? ipv4ForInterface(parsed.iface) : null) ?? parsed.src ?? firstLocalIpv4()

    return {
      gateway: parsed.gateway,
      localIp,
      dns,
      interfaceName: parsed.iface,
      source: parsed.gateway ? source : 'indisponible'
    }
  }

  async function getArpTable(): Promise<ArpEntry[]> {
    const neigh = await run('ip', ['neigh', 'show'], { timeoutMs: 5000 })
    const parsed = parseIpNeigh(neigh.stdout)
    if (parsed.length > 0) return parsed
    const legacy = await run('arp', ['-an'], { timeoutMs: 5000 })
    return parseArpBsd(legacy.stdout)
  }

  async function getConnections(): Promise<RawConnection[]> {
    const ss = await run('ss', ['-tunap'], { timeoutMs: 10000 })
    if (ss.code === 0 && ss.stdout.trim().length > 0) return parseSsOutput(ss.stdout)
    const netstat = await run('netstat', ['-tunap'], { timeoutMs: 10000 })
    if (netstat.code === 0 && netstat.stdout.trim().length > 0) return parseSsOutput(netstat.stdout)
    return readProcConnections()
  }

  let inodeCache: { at: number; map: Map<number, number> } | null = null

  /** Associe les inodes de sockets aux PID via /proc/<pid>/fd (sans ss ni netstat). */
  async function socketInodeMap(): Promise<Map<number, number>> {
    const map = new Map<number, number>()
    let entries: string[] = []
    try {
      entries = await fs.readdir('/proc')
    } catch {
      return map
    }
    const pids = entries.filter((entry) => /^\d+$/.test(entry)).slice(0, 800)
    for (const pid of pids) {
      let fds: string[] = []
      try {
        fds = await fs.readdir(`/proc/${pid}/fd`)
      } catch {
        continue
      }
      for (const fd of fds) {
        try {
          const link = await fs.readlink(`/proc/${pid}/fd/${fd}`)
          const match = /^socket:\[(\d+)\]$/.exec(link)
          if (match) map.set(Number(match[1]), Number(pid))
        } catch {
          // descripteur disparu
        }
      }
    }
    return map
  }

  async function readProcConnections(): Promise<RawConnection[]> {
    const sources: [string, 'TCP' | 'UDP'][] = [
      ['/proc/net/tcp', 'TCP'],
      ['/proc/net/tcp6', 'TCP'],
      ['/proc/net/udp', 'UDP'],
      ['/proc/net/udp6', 'UDP']
    ]
    const entries: ProcNetEntry[] = []
    for (const [file, protocol] of sources) {
      try {
        entries.push(...parseProcNet(await fs.readFile(file, 'utf8'), protocol))
      } catch {
        // fichier absent (IPv6 désactivé par exemple)
      }
    }
    if (entries.length === 0) return []
    const now = Date.now()
    if (!inodeCache || now - inodeCache.at > 15000) {
      inodeCache = { at: now, map: await socketInodeMap() }
    }
    const owners = inodeCache.map
    return entries.map((entry) => ({
      protocol: entry.protocol,
      localAddress: entry.localAddress,
      localPort: entry.localPort,
      remoteAddress: entry.remoteAddress,
      remotePort: entry.remotePort,
      state: entry.state,
      pid: owners.get(entry.inode) ?? null
    }))
  }

  async function getProcessNames(pids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    for (const pid of [...new Set(pids)]) {
      if (!Number.isFinite(pid) || pid <= 0) continue
      try {
        const comm = await fs.readFile(`/proc/${Math.trunc(pid)}/comm`, 'utf8')
        map.set(pid, comm.trim())
      } catch {
        // processus disparu ou droits insuffisants
      }
    }
    return map
  }

  async function getInterfaceCounters(): Promise<CountersResult> {
    try {
      const content = await fs.readFile('/proc/net/dev', 'utf8')
      return { counters: parseProcNetDev(content), source: '/proc/net/dev' }
    } catch {
      return { counters: [], source: 'indisponible' }
    }
  }

  async function ping(host: string, options?: { count?: number; timeoutMs?: number }): Promise<PingResult> {
    const empty: PingResult = {
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
    if (!isSafeHost(host)) return empty
    const count = clampInt(options?.count ?? 1, 1, 20, 1)
    const waitSeconds = Math.max(1, Math.ceil((options?.timeoutMs ?? 900) / 1000))
    const result = await run(
      'ping',
      ['-4', '-n', '-c', String(count), '-i', '0.2', '-W', String(waitSeconds), host],
      { timeoutMs: count * waitSeconds * 1000 + 4000 }
    )
    if (result.code === -1 && (result.error ?? '').includes('introuvable')) {
      // Sans binaire ping (conteneurs, systèmes minimaux), la latence est mesurée par TCP.
      return tcpLatencyPing(host, { count, timeoutMs: options?.timeoutMs ?? 900 })
    }
    const parsed = parsePingOutput(result.stdout, host, count)
    return { ...parsed, error: parsed.received === 0 ? parsed.error ?? result.error : null, method: 'icmp' }
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
    const iwgetid = await run('iwgetid', ['-r'], { timeoutMs: 3000 })
    if (iwgetid.code === 0 && iwgetid.stdout.trim()) return iwgetid.stdout.trim()
    const nmcli = await run('nmcli', ['-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'], { timeoutMs: 5000 })
    if (nmcli.code === 0) {
      const line = nmcli.stdout.split('\n').find((value) => value.startsWith('yes:'))
      if (line) return line.slice(4).trim() || null
    }
    return null
  }

  return {
    platform: 'linux',
    label: 'Linux',
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
