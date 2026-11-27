import type { Connection, ConnectionSnapshot } from '@shared/types'
import { ipInSubnet, isPrivateIpv4, isValidIPv4 } from '@shared/iputil'
import type { PlatformAdapter } from './platform'
import type { Logger } from '../logger'

const LISTENING_STATES = new Set(['LISTEN', 'LISTENING', 'UNCONN', 'IDLE'])
const NAME_CACHE_TTL = 5 * 60_000

export interface ConnectionServiceDeps {
  adapter: PlatformAdapter
  logger: Logger
  now?: () => number
  localSubnet?: () => { network: string; netmask: string } | null
}

function isAnyAddress(address: string): boolean {
  return address === '*' || address === '0.0.0.0' || address === '::' || address === ''
}

export function classifyDirection(
  connection: { protocol: string; localAddress: string; localPort: number; remoteAddress: string; remotePort: number; state: string },
  localNetwork: { network: string; netmask: string } | null
): Connection['direction'] {
  if (LISTENING_STATES.has(connection.state.toUpperCase())) return 'listening'
  if (isAnyAddress(connection.remoteAddress) || connection.remotePort === 0) return 'listening'
  const local = connection.localAddress.replace(/^::ffff:/, '')
  const remote = connection.remoteAddress.replace(/^::ffff:/, '')
  const localIsLoopback = local.startsWith('127.') || local === '::1'
  const remoteIsLoopback = remote.startsWith('127.') || remote === '::1'
  if (localIsLoopback && remoteIsLoopback) return 'local'
  if (!isValidIPv4(remote)) return 'outbound'
  if (localNetwork && isPrivateIpv4(remote) && ipInSubnet(remote, localNetwork.network, localNetwork.netmask)) {
    return connection.localPort < connection.remotePort ? 'inbound' : 'outbound'
  }
  return isPrivateIpv4(remote) ? 'outbound' : 'outbound'
}

export class ConnectionService {
  private readonly nameCache = new Map<number, { name: string; at: number }>()
  private readonly now: () => number
  private lastSnapshot: ConnectionSnapshot | null = null

  constructor(private readonly deps: ConnectionServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  async snapshot(): Promise<ConnectionSnapshot> {
    const { adapter, logger } = this.deps
    let raw: Awaited<ReturnType<PlatformAdapter['getConnections']>> = []
    try {
      raw = await adapter.getConnections()
    } catch (error) {
      logger.warn('Lecture des connexions réseau impossible', error)
      const empty: ConnectionSnapshot = {
        timestamp: this.now(),
        connections: [],
        counts: { total: 0, tcp: 0, udp: 0, established: 0, listening: 0 },
        topProcesses: []
      }
      this.lastSnapshot = empty
      return empty
    }

    const now = this.now()
    for (const [pid, entry] of this.nameCache) {
      if (now - entry.at > NAME_CACHE_TTL) this.nameCache.delete(pid)
    }
    const unknownPids = [...new Set(raw.map((entry) => entry.pid).filter((pid): pid is number => typeof pid === 'number' && pid > 0))]
      .filter((pid) => !this.nameCache.has(pid))
      .slice(0, 120)
    if (unknownPids.length > 0) {
      try {
        const names = await adapter.getProcessNames(unknownPids)
        for (const [pid, name] of names) this.nameCache.set(pid, { name, at: now })
      } catch (error) {
        logger.debug('Résolution des noms de processus partielle', error)
      }
    }
    if (this.nameCache.size > 3000) this.nameCache.clear()

    const localNetwork = this.deps.localSubnet?.() ?? null
    const connections: Connection[] = raw.map((entry) => {
      const pid = entry.pid ?? null
      const processName = pid !== null ? this.nameCache.get(pid)?.name ?? null : null
      return {
        protocol: entry.protocol,
        localAddress: entry.localAddress,
        localPort: entry.localPort,
        remoteAddress: entry.remoteAddress,
        remotePort: entry.remotePort,
        state: entry.state,
        pid,
        processName,
        direction: classifyDirection(entry, localNetwork)
      }
    })

    connections.sort((a, b) => {
      const order: Record<Connection['direction'], number> = { inbound: 0, outbound: 1, listening: 2, local: 3 }
      const byDirection = order[a.direction] - order[b.direction]
      if (byDirection !== 0) return byDirection
      return (a.processName ?? '').localeCompare(b.processName ?? '')
    })

    const counts = {
      total: connections.length,
      tcp: connections.filter((entry) => entry.protocol === 'TCP').length,
      udp: connections.filter((entry) => entry.protocol === 'UDP').length,
      established: connections.filter((entry) => entry.state === 'ESTABLISHED' || entry.state === 'ESTAB').length,
      listening: connections.filter((entry) => entry.direction === 'listening').length
    }

    const byProcess = new Map<string, number>()
    for (const connection of connections) {
      const name = connection.processName ?? 'Processus inconnu'
      byProcess.set(name, (byProcess.get(name) ?? 0) + 1)
    }
    const topProcesses = [...byProcess.entries()]
      .map(([name, value]) => ({ name, connections: value }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 8)

    const snapshot: ConnectionSnapshot = { timestamp: now, connections, counts, topProcesses }
    this.lastSnapshot = snapshot
    return snapshot
  }

  getLast(): ConnectionSnapshot | null {
    return this.lastSnapshot
  }
}
