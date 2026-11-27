import type { RawConnection } from '../types'

export interface ProcNetEntry extends RawConnection {
  inode: number
}

const TCP_STATES: Record<string, string> = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING'
}

function decodeIpv4(hex: string): string | null {
  if (hex.length !== 8) return null
  const bytes: number[] = []
  for (let index = 6; index >= 0; index -= 2) {
    bytes.push(parseInt(hex.slice(index, index + 2), 16))
  }
  if (bytes.some((value) => Number.isNaN(value))) return null
  return bytes.join('.')
}

function decodeIpv6(hex: string): string | null {
  if (hex.length !== 32) return null
  const groups: string[] = []
  for (let offset = 0; offset < 32; offset += 8) {
    const chunk = hex.slice(offset, offset + 8)
    const bytes: string[] = []
    for (let index = 6; index >= 0; index -= 2) bytes.push(chunk.slice(index, index + 2))
    groups.push(bytes.join('').replace(/^0+(?=.)/, '').toLowerCase())
  }
  const compressed = groups.join(':').replace(/\b0:0:0:0:0:0:0:0\b/, '::')
  return compressed
}

function decodeAddress(hex: string): string | null {
  return hex.length === 8 ? decodeIpv4(hex) : decodeIpv6(hex)
}

function splitAddress(value: string): { address: string; port: number } | null {
  const separator = value.lastIndexOf(':')
  if (separator <= 0) return null
  const address = decodeAddress(value.slice(0, separator))
  const port = parseInt(value.slice(separator + 1), 16)
  if (!address || Number.isNaN(port)) return null
  return { address, port }
}

/**
 * Analyse /proc/net/tcp, /proc/net/udp et leurs variantes IPv6.
 * Utilisé quand ni `ss` ni `netstat` ne sont disponibles (systèmes minimaux).
 */
export function parseProcNet(content: string, protocol: 'TCP' | 'UDP'): ProcNetEntry[] {
  const entries: ProcNetEntry[] = []
  const lines = content.split(/\r?\n/).slice(1)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const tokens = line.split(/\s+/)
    if (tokens.length < 10) continue
    const local = splitAddress(tokens[1])
    const remote = splitAddress(tokens[2])
    if (!local) continue
    const inode = Number(tokens[9])
    const listening = tokens[3] === '0A'
    const remoteUnspecified = !remote || (remote.address === '0.0.0.0' || remote.address === '::') && remote.port === 0
    entries.push({
      protocol,
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remoteUnspecified ? '*' : remote.address,
      remotePort: remoteUnspecified ? 0 : remote.port,
      state: listening ? 'LISTEN' : (TCP_STATES[tokens[3]] ?? tokens[3]),
      pid: null,
      inode: Number.isFinite(inode) ? inode : 0
    })
  }
  return entries
}

export function tcpStateLabel(code: string): string {
  return TCP_STATES[code] ?? code
}
