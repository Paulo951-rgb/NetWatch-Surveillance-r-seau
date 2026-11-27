import os from 'node:os'
import type { NetworkInfo, NetworkInterfaceInfo, Settings } from '@shared/types'
import { guessScanRange, isValidIPv4, normalizeMac, subnetOf } from '@shared/iputil'
import type { PlatformAdapter } from './platform'
import { httpsGetJson } from './http'
import type { Logger } from '../logger'

const VIRTUAL_PATTERN =
  /(vEthernet|virtualbox|vmware|hyper-v|loopback|teredo|isatap|bluetooth|wsl|docker|veth|virbr|br-|vmnet|vboxnet|utun|awdl|llw|tailscale|wireguard|tun\d|tap\d)/i

export function isVirtualInterfaceName(name: string): boolean {
  return VIRTUAL_PATTERN.test(name)
}

export function listNetworkInterfaces(): NetworkInterfaceInfo[] {
  const result: NetworkInterfaceInfo[] = []
  const interfaces = os.networkInterfaces()
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue
      if (entry.address === '127.0.0.1') continue
      const prefix = netmaskPrefix(entry.netmask)
      result.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        cidr: prefix > 0 ? `${subnetOf(entry.address, entry.netmask)}/${prefix}` : null,
        mac: normalizeMac(entry.mac),
        family: 'IPv4',
        internal: entry.internal,
        virtual: isVirtualInterfaceName(name)
      })
    }
  }
  return result.sort((a, b) => Number(a.virtual) - Number(b.virtual) || a.name.localeCompare(b.name))
}

function netmaskPrefix(netmask: string): number {
  if (!isValidIPv4(netmask)) return 0
  let prefix = 0
  const parts = netmask.split('.').map(Number)
  for (const part of parts) {
    let byte = part
    for (let bit = 0; bit < 8; bit++) {
      if (byte & 0x80) prefix++
      byte <<= 1
    }
  }
  return prefix
}

export interface NetworkInfoDeps {
  adapter: PlatformAdapter
  getSettings: () => Settings
  logger: Logger
  now?: () => number
  publicIpProvider?: (timeoutMs: number) => Promise<string | null>
}

const PUBLIC_IP_TTL = 10 * 60_000
const INFO_TTL = 5000

export class NetworkInfoService {
  private cached: NetworkInfo | null = null
  private cachedAt = 0
  private publicIp: { value: string | null; at: number } = { value: null, at: 0 }
  private readonly now: () => number

  constructor(private readonly deps: NetworkInfoDeps) {
    this.now = deps.now ?? Date.now
  }

  async get(force = false): Promise<NetworkInfo> {
    if (!force && this.cached && this.now() - this.cachedAt < INFO_TTL) return this.cached
    return this.refresh()
  }

  async refresh(): Promise<NetworkInfo> {
    const { adapter, getSettings } = this.deps
    const settings = getSettings()
    const interfaces = listNetworkInterfaces()
    let route = { gateway: null as string | null, localIp: null as string | null, dns: [] as string[], interfaceName: null as string | null, source: 'indisponible' }
    try {
      route = await adapter.getRouteInfo()
    } catch (error) {
      this.deps.logger.warn('Lecture de la route par défaut impossible', error)
    }

    const primary = pickPrimaryInterface(interfaces, route.localIp)
    const localIp = route.localIp && isValidIPv4(route.localIp) ? route.localIp : primary?.address ?? null
    const primaryIface = interfaces.find((entry) => entry.address === localIp) ?? primary ?? null
    let ssid: string | null = null
    try {
      ssid = await adapter.getWifiSsid()
    } catch {
      ssid = null
    }

    const publicIpEnabled = settings.privacy.allowPublicIp
    const publicIpValue = publicIpEnabled ? await this.getPublicIp() : null

    const info: NetworkInfo = {
      hostname: os.hostname(),
      localIp,
      mac: primaryIface?.mac || null,
      gateway: route.gateway,
      dns: route.dns,
      publicIp: publicIpValue,
      publicIpEnabled,
      interfaces,
      connectionType: detectConnectionType(primaryIface?.name ?? null, ssid),
      ssid,
      subnet: primaryIface ? guessScanRange(primaryIface.address, primaryIface.netmask) : null,
      updatedAt: this.now()
    }
    this.cached = info
    this.cachedAt = this.now()
    return info
  }

  async getPublicIp(force = false): Promise<string | null> {
    const settings = this.deps.getSettings()
    if (!settings.privacy.allowPublicIp) return null
    if (!force && this.now() - this.publicIp.at < PUBLIC_IP_TTL) return this.publicIp.value
    const provider = this.deps.publicIpProvider ?? defaultPublicIpProvider
    try {
      const value = await provider(5000)
      this.publicIp = { value, at: this.now() }
      return value
    } catch (error) {
      this.deps.logger.warn('Adresse IP publique indisponible', error)
      this.publicIp = { value: null, at: this.now() }
      return null
    }
  }

  /** Dernière valeur connue, sans requête système. */
  getLastCached(): NetworkInfo | null {
    return this.cached
  }

  invalidate(): void {
    this.cachedAt = 0
  }
}

export async function defaultPublicIpProvider(timeoutMs: number): Promise<string | null> {
  const payload = (await httpsGetJson('https://api.ipify.org?format=json', timeoutMs)) as { ip?: string }
  const ip = payload?.ip
  return typeof ip === 'string' && isValidIPv4(ip) ? ip : null
}

export function pickPrimaryInterface(
  interfaces: NetworkInterfaceInfo[],
  localIp: string | null
): NetworkInterfaceInfo | null {
  if (localIp) {
    const match = interfaces.find((entry) => entry.address === localIp)
    if (match) return match
  }
  const physical = interfaces.filter((entry) => !entry.virtual)
  return physical[0] ?? interfaces[0] ?? null
}

export function detectConnectionType(
  interfaceName: string | null,
  ssid: string | null
): NetworkInfo['connectionType'] {
  if (ssid) return 'wifi'
  if (!interfaceName) return 'unknown'
  if (/(wi-?fi|wlan|wireless|wlp|airport)/i.test(interfaceName)) return 'wifi'
  if (/(ethernet|eth\d|en\d|local area|lan)/i.test(interfaceName)) return 'ethernet'
  return 'unknown'
}
