/** Utilitaires IPv4 / MAC purs (testables, sans dépendance système). */

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isValidIPv4(ip: string): boolean {
  return IPV4_RE.test(ip)
}

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.')
  if (parts.length !== 4) return 0
  return parts.reduce((acc, part) => ((acc << 8) + (Number(part) & 255)) >>> 0, 0) >>> 0
}

export function intToIpv4(value: number): string {
  const n = value >>> 0
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function netmaskToPrefix(mask: string): number {
  if (!isValidIPv4(mask)) return 0
  const n = ipv4ToInt(mask)
  let prefix = 0
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) prefix++
    else break
  }
  return prefix
}

export function prefixToNetmask(prefix: number): string {
  const p = Math.max(0, Math.min(32, Math.trunc(prefix)))
  const n = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0
  return intToIpv4(n)
}

export interface CidrRange {
  network: string
  broadcast: string
  first: string
  last: string
  prefix: number
  hostCount: number
  hosts: string[]
}

/**
 * Décompose un CIDR en plage d'hôtes utilisables. `maxHosts` protège contre
 * les plages démesurées (ex: /8) qui rendraient un scan irréaliste.
 */
export function cidrToRange(cidr: string, maxHosts = 1024): CidrRange | null {
  const [ip, prefixRaw] = cidr.split('/')
  if (!isValidIPv4(ip) || prefixRaw === undefined) return null
  const prefix = Number(prefixRaw)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null

  const mask = ipv4ToInt(prefixToNetmask(prefix))
  const base = ipv4ToInt(ip)
  const network = (base & mask) >>> 0
  const size = 2 ** (32 - prefix)
  const broadcast = (network + size - 1) >>> 0

  let first: number
  let last: number
  if (prefix >= 31) {
    first = network
    last = broadcast
  } else {
    first = network + 1
    last = broadcast - 1
  }
  const hostCount = last >= first ? last - first + 1 : 0
  const limit = Math.min(hostCount, maxHosts)
  const hosts: string[] = []
  for (let i = 0; i < limit; i++) hosts.push(intToIpv4(first + i))
  return {
    network: intToIpv4(network),
    broadcast: intToIpv4(broadcast),
    first: intToIpv4(first),
    last: intToIpv4(last),
    prefix,
    hostCount,
    hosts
  }
}

export function isValidCidr(cidr: string): boolean {
  return cidrToRange(cidr, 1) !== null
}

export function subnetOf(ip: string, netmask: string): string {
  if (!isValidIPv4(ip) || !isValidIPv4(netmask)) return ''
  return intToIpv4((ipv4ToInt(ip) & ipv4ToInt(netmask)) >>> 0)
}

export function ipInSubnet(ip: string, networkIp: string, netmask: string): boolean {
  if (!isValidIPv4(ip)) return false
  return subnetOf(ip, netmask) === subnetOf(networkIp, netmask)
}

export function isPrivateIpv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false
  const n = ipv4ToInt(ip)
  const a = (n >>> 24) & 255
  const b = (n >>> 16) & 255
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  return false
}

export function isLoopbackIpv4(ip: string): boolean {
  return isValidIPv4(ip) && (ipv4ToInt(ip) >>> 24) === 127
}

export function isMulticastIpv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false
  const a = (ipv4ToInt(ip) >>> 24) & 255
  return a >= 224 && a <= 239
}

export function isBroadcastIpv4(ip: string): boolean {
  return ip === '255.255.255.255' || ip.endsWith('.255')
}

const MAC_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i

export function isValidMac(mac: string): boolean {
  return MAC_RE.test(mac.trim())
}

/** Normalise en `aa:bb:cc:dd:ee:ff` minuscule. Retourne '' si invalide. */
export function normalizeMac(mac: string | null | undefined): string {
  if (!mac) return ''
  const cleaned = mac.trim().toLowerCase().replace(/-/g, ':')
  if (!isValidMac(cleaned)) return ''
  return cleaned
    .split(':')
    .map((part) => part.padStart(2, '0'))
    .join(':')
}

/** Une MAC de groupe (multicast / broadcast) ne peut pas être un hôte réel. */
export function isMulticastMac(mac: string): boolean {
  const normalized = normalizeMac(mac)
  if (!normalized) return false
  const first = parseInt(normalized.slice(0, 2), 16)
  return (first & 1) === 1
}

export function isLocallyAdministeredMac(mac: string): boolean {
  const normalized = normalizeMac(mac)
  if (!normalized) return false
  const first = parseInt(normalized.slice(0, 2), 16)
  return (first & 2) === 2
}

/** Convertit une MAC en adresse IPv6 link-local (EUI-64) pour retrouver l'hôte. */
export function macToLinkLocalIpv6(mac: string): string | null {
  const normalized = normalizeMac(mac)
  if (!normalized) return null
  const bytes = normalized.split(':').map((b) => parseInt(b, 16))
  bytes[0] ^= 0x02
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'))
  return `fe80::${hex[0]}${hex[1]}:${hex[2]}ff:fe${hex[3]}:${hex[4]}${hex[5]}`
}

/**
 * Choisit une plage de scan raisonnable : si le masque est plus large qu'un /24,
 * on restreint au /24 de l'adresse locale pour éviter 65 000 requêtes.
 */
export function guessScanRange(ip: string, netmask: string): string | null {
  if (!isValidIPv4(ip) || !isValidIPv4(netmask)) return null
  const prefix = netmaskToPrefix(netmask)
  if (prefix === 0 || prefix > 30) return null
  if (prefix < 24) {
    const n = ipv4ToInt(ip)
    const masked = (n & (0xffffff00 >>> 0)) >>> 0
    return `${intToIpv4(masked)}/24`
  }
  return `${subnetOf(ip, netmask)}/${prefix}`
}

export function sortIpv4(list: string[]): string[] {
  return [...list].sort((a, b) => ipv4ToInt(a) - ipv4ToInt(b))
}

/** Indique si une IP est un cas spécial non scannable. */
export function isSpecialIpv4(ip: string): boolean {
  return (
    isLoopbackIpv4(ip) ||
    isMulticastIpv4(ip) ||
    ip === '0.0.0.0' ||
    ip === '255.255.255.255' ||
    ip.endsWith('.0') ||
    ip.endsWith('.255')
  )
}
