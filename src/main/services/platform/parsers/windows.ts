import { isValidIPv4, normalizeMac } from '@shared/iputil'
import type { ArpEntry, InterfaceCounters, RawConnection } from '../types'

/** `Interface : 192.168.1.10 --- 0x5` / `Interface: 192.168.1.10 --- 0x5` */
const ARP_IFACE_RE = /^\s*Interface\s*:?\s*(\d{1,3}(?:\.\d{1,3}){3})/i
const ARP_ENTRY_RE = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s+(\S+)/

export function parseArpWindows(output: string): ArpEntry[] {
  const entries: ArpEntry[] = []
  const seen = new Set<string>()
  let currentIface: string | null = null
  for (const rawLine of output.split(/\r?\n/)) {
    const iface = ARP_IFACE_RE.exec(rawLine)
    if (iface) {
      currentIface = iface[1]
      continue
    }
    const entry = ARP_ENTRY_RE.exec(rawLine)
    if (!entry) continue
    const ip = entry[1]
    const mac = normalizeMac(entry[2])
    if (!isValidIPv4(ip) || !mac) continue
    const key = `${ip}|${mac}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ ip, mac, iface: currentIface })
  }
  return entries
}

/** Découpe `192.168.1.1:443`, `[::]:80`, `[fe80::1%12]:1900`, `*:*`. */
export function splitHostPort(token: string): { address: string; port: number } {
  if (token === '*:*' || token === '*' || token === '') return { address: '*', port: 0 }
  if (token.startsWith('[')) {
    const end = token.indexOf(']')
    if (end > 0) {
      const address = token.slice(1, end)
      const portPart = token.slice(end + 1).replace(/^:/, '')
      const port = Number(portPart)
      return { address, port: Number.isFinite(port) ? port : 0 }
    }
  }
  const idx = token.lastIndexOf(':')
  if (idx <= 0) return { address: token, port: 0 }
  const address = token.slice(0, idx)
  const port = Number(token.slice(idx + 1))
  return { address, port: Number.isFinite(port) ? port : 0 }
}

const NETSTAT_RE = /^(TCP|UDP)\s+(\S+)\s+(\S+)(?:\s+(\S+))?\s+(\d+)$/

export function parseNetstatWindows(output: string): RawConnection[] {
  const connections: RawConnection[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = NETSTAT_RE.exec(line)
    if (!match) continue
    const protocol = match[1] as 'TCP' | 'UDP'
    const local = splitHostPort(match[2])
    const remote = splitHostPort(match[3])
    const state = match[4] ?? (protocol === 'UDP' ? 'UDP' : 'UNKNOWN')
    const pid = Number(match[5])
    connections.push({
      protocol,
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      state: state.toUpperCase(),
      pid: Number.isFinite(pid) ? pid : null
    })
  }
  return connections
}

/** `"chrome.exe","8124","Console","1","234 567 Ko"` */
export function parseTasklistCsv(output: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^"([^"]*)","(\d+)"/.exec(rawLine.trim())
    if (!match) continue
    const pid = Number(match[2])
    if (Number.isFinite(pid)) map.set(pid, match[1])
  }
  return map
}

/** Analyse une sortie PowerShell `ConvertTo-Json -Compress` (objet ou tableau). */
export function parsePowerShellJson<T = Record<string, unknown>>(output: string): T[] {
  const cleaned = output.replace(/^\uFEFF/, '').trim()
  if (!cleaned) return []
  const start = Math.min(
    ...['[', '{']
      .map((c) => cleaned.indexOf(c))
      .filter((i) => i >= 0)
  )
  if (!Number.isFinite(start) || start < 0) return []
  const slice = cleaned.slice(start)
  try {
    const parsed = JSON.parse(slice)
    if (Array.isArray(parsed)) return parsed.filter((v) => v !== null) as T[]
    if (parsed && typeof parsed === 'object') return [parsed as T]
  } catch {
    return []
  }
  return []
}

/**
 * `route print -4 0.0.0.0` : ligne par défaut
 * `          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.10     25`
 */
export function parseRoutePrintDefault(output: string): {
  gateway: string
  localIp: string | null
  interfaceIndex: string | null
} | null {
  for (const rawLine of output.split(/\r?\n/)) {
    const match =
      /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)/.exec(
        rawLine
      )
    if (match && isValidIPv4(match[1])) {
      return {
        gateway: match[1],
        localIp: isValidIPv4(match[2]) && match[2] !== '0.0.0.0' ? match[2] : null,
        interfaceIndex: match[3]
      }
    }
  }
  return null
}

/** `netsh interface ip show dnsservers` : on récupère toutes les IPv4 présentes. */
export function parseNetshDns(output: string): string[] {
  const found = output.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []
  const unique = [...new Set(found.filter((ip) => isValidIPv4(ip) && ip !== '0.0.0.0'))]
  return unique
}

/** `netsh wlan show interfaces` */
export function parseNetshWifiSsid(output: string): string | null {
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^\s*SSID\s*:\s*(.+)$/i.exec(rawLine)
    if (match) {
      const value = match[1].trim()
      if (value && value !== '—') return value
    }
  }
  return null
}

/** `netstat -e` : octets reçus / envoyés (ligne « Octets » ou « Bytes »). */
export function parseNetstatE(output: string): { rxBytes: number; txBytes: number } | null {
  const match = /^\s*(?:Octets|Bytes)\s+(\d+)\s+(\d+)/im.exec(output)
  if (!match) return null
  const rxBytes = Number(match[1])
  const txBytes = Number(match[2])
  if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) return null
  return { rxBytes, txBytes }
}

/** `Get-NetAdapterStatistics | Select Name,ReceivedBytes,SentBytes | ConvertTo-Json` */
export function parseNetAdapterStatistics(output: string): InterfaceCounters[] {
  const rows = parsePowerShellJson<Record<string, unknown>>(output)
  const counters: InterfaceCounters[] = []
  for (const row of rows) {
    const name = String(row.Name ?? row.name ?? '').trim()
    const rx = Number(row.ReceivedBytes ?? row.receivedBytes ?? NaN)
    const tx = Number(row.SentBytes ?? row.sentBytes ?? NaN)
    if (!name || !Number.isFinite(rx) || !Number.isFinite(tx)) continue
    counters.push({ name, rxBytes: rx, txBytes: tx })
  }
  return counters
}

export interface NetIpConfiguration {
  interfaceAlias: string
  ipv4: string | null
  gateway: string | null
  dns: string[]
}

export function parseNetIpConfiguration(output: string): NetIpConfiguration[] {
  const rows = parsePowerShellJson<Record<string, unknown>>(output)
  const configs: NetIpConfiguration[] = []
  for (const row of rows) {
    const alias = String(row.InterfaceAlias ?? row.interfaceAlias ?? '').trim()
    const ipv4Raw = row.IPv4 ?? row.ipv4
    const ipv4 = typeof ipv4Raw === 'string' && isValidIPv4(ipv4Raw) ? ipv4Raw : null
    const gatewayRaw = row.Gateway ?? row.gateway
    const gateway = typeof gatewayRaw === 'string' && isValidIPv4(gatewayRaw) ? gatewayRaw : null
    const dnsRaw = row.Dns ?? row.dns
    const dns = (Array.isArray(dnsRaw) ? dnsRaw : dnsRaw ? [dnsRaw] : [])
      .map((value) => String(value).trim())
      .filter((value) => isValidIPv4(value))
    if (!alias && !ipv4 && !gateway) continue
    configs.push({ interfaceAlias: alias, ipv4, gateway, dns })
  }
  return configs
}

/** `Get-Process | Select Id,ProcessName | ConvertTo-Json` */
export function parseProcessJson(output: string): Map<number, string> {
  const rows = parsePowerShellJson<Record<string, unknown>>(output)
  const map = new Map<number, string>()
  for (const row of rows) {
    const pid = Number(row.Id ?? row.id ?? NaN)
    const name = String(row.ProcessName ?? row.processName ?? '').trim()
    if (Number.isFinite(pid) && name) map.set(pid, name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`)
  }
  return map
}
