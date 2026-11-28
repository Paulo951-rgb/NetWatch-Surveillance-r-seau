import { isValidIPv4, normalizeMac } from '@shared/iputil'
import type { ArpEntry, InterfaceCounters, RawConnection } from '../types'

/** `/proc/net/dev` (Linux). */
export function parseProcNetDev(output: string): InterfaceCounters[] {
  const counters: InterfaceCounters[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^\s*([^:]+):\s*(.+)$/.exec(rawLine)
    if (!match) continue
    const name = match[1].trim()
    const fields = match[2].trim().split(/\s+/).map(Number)
    if (fields.length < 9) continue
    const rxBytes = fields[0]
    const txBytes = fields[8]
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue
    counters.push({ name, rxBytes, txBytes })
  }
  return counters
}

/** `ip neigh` (Linux). */
export function parseIpNeigh(output: string): ArpEntry[] {
  const entries: ArpEntry[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\s+dev\s+(\S+)\s+lladdr\s+(\S+)\s+(\S+)/.exec(
      rawLine.trim()
    )
    if (!match) continue
    const mac = normalizeMac(match[3])
    if (!isValidIPv4(match[1]) || !mac) continue
    entries.push({ ip: match[1], mac, iface: match[2] })
  }
  return entries
}

/** `arp -an` (macOS / BSD). */
export function parseArpBsd(output: string): ArpEntry[] {
  const entries: ArpEntry[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^\S+\s+\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F:]+)/.exec(rawLine.trim())
    if (!match) continue
    const mac = normalizeMac(match[2])
    if (!isValidIPv4(match[1]) || !mac) continue
    entries.push({ ip: match[1], mac, iface: null })
  }
  return entries
}

/**
 * `ss -tunapH` : `tcp ESTAB 0 0 192.168.1.10:22 192.168.1.5:51234 users:(("sshd",pid=1234,fd=3))`
 * Le nom de processus est optionnel (droits insuffisants pour les autres PID).
 */
export function parseSsOutput(output: string): (RawConnection & { processName: string | null })[] {
  const connections: (RawConnection & { processName: string | null })[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const tokens = line.split(/\s+/)
    if (tokens.length < 6) continue
    const netid = tokens[0].toLowerCase()
    if (netid !== 'tcp' && netid !== 'udp') continue
    const state = tokens[1]
    const local = tokens[4]
    const peer = tokens[5]
    const processPart = tokens.slice(6).join(' ')
    const localSplit = splitUnixHostPort(local)
    const peerSplit = splitUnixHostPort(peer)
    if (!localSplit) continue
    const procMatch = /users:\(\("([^"]+)",pid=(\d+)/.exec(processPart)
    connections.push({
      protocol: netid === 'tcp' ? 'TCP' : 'UDP',
      localAddress: localSplit.address,
      localPort: localSplit.port,
      remoteAddress: peerSplit?.address ?? '*',
      remotePort: peerSplit?.port ?? 0,
      state: state.toUpperCase(),
      pid: procMatch ? Number(procMatch[2]) : null,
      processName: procMatch ? procMatch[1] : null
    })
  }
  return connections
}

export function splitUnixHostPort(token: string): { address: string; port: number } | null {
  if (!token) return null
  if (token === '*:*') return { address: '*', port: 0 }
  if (token.startsWith('[')) {
    const end = token.indexOf(']')
    if (end > 0) {
      const address = token.slice(1, end)
      const port = Number(token.slice(end + 1).replace(/^:/, ''))
      return { address, port: Number.isFinite(port) ? port : 0 }
    }
  }
  const idx = token.lastIndexOf(':')
  if (idx < 0) return { address: token, port: 0 }
  const address = token.slice(0, idx)
  const port = Number(token.slice(idx + 1))
  if (!Number.isFinite(port)) return null
  return { address: address === '*' ? '*' : address, port }
}

/** `ip route show default` */
export function parseIpRouteDefault(output: string): { gateway: string | null; iface: string | null; src: string | null } {
  const match = /default\s+via\s+(\S+)\s+dev\s+(\S+)(?:\s+.*?\bsrc\s+(\S+))?/.exec(output)
  if (!match) return { gateway: null, iface: null, src: null }
  return {
    gateway: isValidIPv4(match[1]) ? match[1] : null,
    iface: match[2] ?? null,
    src: match[3] && isValidIPv4(match[3]) ? match[3] : null
  }
}

/** `/etc/resolv.conf` */
export function parseResolvConf(content: string): string[] {
  const servers: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const match = /^\s*nameserver\s+(\S+)/i.exec(rawLine)
    if (match && isValidIPv4(match[1])) servers.push(match[1])
  }
  return [...new Set(servers)]
}

/**
 * `netstat -ibn` (macOS) : une ligne par interface avec compteurs cumulés.
 * On retient la première ligne de chaque interface (ligne <Link#X>).
 */
export function parseNetstatIBN(output: string): InterfaceCounters[] {
  const byName = new Map<string, InterfaceCounters>()
  for (const rawLine of output.split(/\r?\n/)) {
    const tokens = rawLine.trim().split(/\s+/)
    if (tokens.length < 10) continue
    const name = tokens[0]
    if (!/^[a-z]+\d+$/i.test(name)) continue
    if (byName.has(name)) continue
    // Les 7 derniers champs sont toujours : Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
    const tail = tokens.slice(-7).map((token) => Number(token))
    if (tail.length < 7) continue
    const [ipkts, , ibytes, opkts, , obytes] = tail
    if (![ipkts, ibytes, opkts, obytes].every((n) => Number.isFinite(n))) continue
    byName.set(name, { name, rxBytes: ibytes, txBytes: obytes })
  }
  return [...byName.values()]
}

/**
 * `netstat -anv -p tcp|udp` (macOS). Les adresses utilisent la forme
 * `192.168.1.10.49732` (dernier point = port).
 */
export function parseNetstatBsd(output: string): RawConnection[] {
  const connections: RawConnection[] = []
  const states = /^(ESTABLISHED|LISTEN|SYN_SENT|SYN_RCVD|FIN_WAIT_1|FIN_WAIT_2|CLOSE_WAIT|CLOSING|LAST_ACK|TIME_WAIT|CLOSED|CLOSE|IDLE)$/
  for (const rawLine of output.split(/\r?\n/)) {
    const tokens = rawLine.trim().split(/\s+/)
    if (tokens.length < 6) continue
    const proto = tokens[0].toLowerCase()
    if (!/^(tcp4|tcp6|udp4|udp6)$/.test(proto)) continue
    const local = splitBsdHostPort(tokens[3])
    const peer = splitBsdHostPort(tokens[4])
    if (!local) continue
    let state = 'UNKNOWN'
    let stateIndex = -1
    for (let i = 5; i < tokens.length; i++) {
      if (states.test(tokens[i])) {
        state = tokens[i]
        stateIndex = i
        break
      }
    }
    // Colonnes netstat -v : (state) rhiwat shiwat pid epid flags options
    const pidIndex = stateIndex >= 0 ? stateIndex + 3 : 7
    const pidCandidate = Number(tokens[pidIndex])
    const pid = Number.isFinite(pidCandidate) && pidCandidate > 0 ? pidCandidate : null
    connections.push({
      protocol: proto.startsWith('tcp') ? 'TCP' : 'UDP',
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: peer?.address ?? '*',
      remotePort: peer?.port ?? 0,
      state,
      pid
    })
  }
  return connections
}

function splitBsdHostPort(token: string): { address: string; port: number } | null {
  if (!token) return null
  if (token === '*.*') return { address: '*', port: 0 }
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return { address: token, port: 0 }
  const address = token.slice(0, idx).replace(/^\*$/, '*')
  const port = Number(token.slice(idx + 1))
  if (!Number.isFinite(port)) return null
  return { address, port }
}

/** `route -n get default` (macOS) */
export function parseMacRouteDefault(output: string): { gateway: string | null; iface: string | null } {
  const gateway = /gateway:\s*(\d{1,3}(?:\.\d{1,3}){3})/.exec(output)?.[1] ?? null
  const iface = /interface:\s*(\S+)/.exec(output)?.[1] ?? null
  return { gateway: gateway && isValidIPv4(gateway) ? gateway : null, iface }
}

/** `scutil --dns` (macOS) : récupère les résolveurs. */
export function parseScutilDns(output: string): string[] {
  const found = output.match(/nameserver\[\d+\]\s*:\s*(\d{1,3}(?:\.\d{1,3}){3})/g) ?? []
  const servers = found
    .map((line) => line.split(':').pop()?.trim() ?? '')
    .filter((ip) => isValidIPv4(ip))
  return [...new Set(servers)]
}
