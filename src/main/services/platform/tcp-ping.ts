import { Socket } from 'node:net'
import type { PingResult } from './types'

const DEFAULT_PORTS = [443, 80, 53, 22, 445, 8080, 3389]

function connectOnce(host: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint()
    const socket = new Socket()
    let settled = false
    const finish = (value: number | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(Number(process.hrtime.bigint() - startedAt) / 1_000_000))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
    try {
      socket.connect({ host, port })
    } catch {
      finish(null)
    }
  })
}

/**
 * Mesure de latence de secours sans ICMP : temps d'établissement TCP.
 * Utilisée lorsque l'outil `ping` du système est absent (conteneurs, systèmes minimaux).
 */
export async function tcpLatencyPing(
  host: string,
  options: { count?: number; timeoutMs?: number; ports?: number[] } = {}
): Promise<PingResult> {
  const count = Math.max(1, Math.min(20, Math.trunc(options.count ?? 1)))
  const timeoutMs = Math.max(200, Math.min(5000, Math.trunc(options.timeoutMs ?? 900)))
  const ports = options.ports && options.ports.length > 0 ? options.ports : DEFAULT_PORTS
  const times: number[] = []
  for (let attempt = 0; attempt < count; attempt++) {
    let measured: number | null = null
    for (const port of ports) {
      measured = await connectOnce(host, port, timeoutMs)
      if (measured !== null) break
    }
    if (measured !== null) times.push(Math.round(measured * 100) / 100)
  }
  const received = times.length
  const rttMs = received > 0 ? times.reduce((sum, value) => sum + value, 0) / received : null
  return {
    host,
    sent: count,
    received,
    lossPercent: count > 0 ? ((count - received) / count) * 100 : 100,
    rttMs,
    minMs: received > 0 ? Math.min(...times) : null,
    maxMs: received > 0 ? Math.max(...times) : null,
    times,
    available: received > 0,
    error: received > 0 ? null : 'Aucune réponse TCP (outil ping indisponible)',
    method: 'tcp'
  }
}
