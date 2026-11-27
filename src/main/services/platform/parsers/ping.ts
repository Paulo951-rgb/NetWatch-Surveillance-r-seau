import type { PingResult } from '../types'

/**
 * Analyseur de sortie `ping` multi-plateforme (Windows / Linux / macOS).
 * On ne s'appuie que sur des marqueurs ASCII (TTL, time=/temps=, packets
 * transmitted, ...) car la sortie localisée de Windows peut être mal décodée
 * selon la page de code de la console.
 */
export function parsePingOutput(output: string, host: string, requestedCount = 1): PingResult {
  const times: number[] = []

  const timeRe = /(?:temps|time|tiempo)\s*[=<]\s*([\d]+(?:[.,][\d]+)?)\s*ms/gi
  let match: RegExpExecArray | null
  while ((match = timeRe.exec(output)) !== null) {
    const raw = match[1].replace(',', '.')
    const value = Number(raw)
    if (Number.isFinite(value)) {
      // `temps<1ms` signifie « moins d'une milliseconde »
      times.push(match[0].includes('<') ? Math.max(0.1, value / 2) : value)
    }
  }

  const ttlMatches = output.match(/ttl[=:]\s*\d+/gi)
  const replyCount = ttlMatches ? ttlMatches.length : 0

  const transmitted = Number(
    /(\d+)\s+packets?\s+transmitted/i.exec(output)?.[1] ??
      /(?:envoy[ée]s|Sent)\s*=\s*(\d+)/i.exec(output)?.[1] ??
      requestedCount
  )
  const receivedFromSummary = Number(
    /(\d+)\s+(?:packets\s+)?received/i.exec(output)?.[1] ??
      /(?:re[çc]us|Received)\s*=\s*(\d+)/i.exec(output)?.[1] ??
      NaN
  )

  const sent = Number.isFinite(transmitted) && transmitted > 0 ? transmitted : requestedCount
  const received = Number.isFinite(receivedFromSummary)
    ? Math.min(receivedFromSummary, sent)
    : Math.min(Math.max(replyCount, times.length), sent)

  const lossPercent = sent > 0 ? ((sent - received) / sent) * 100 : 100
  const rttMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null

  return {
    host,
    sent,
    received,
    lossPercent: Math.round(lossPercent * 10) / 10,
    rttMs,
    minMs: times.length ? Math.min(...times) : null,
    maxMs: times.length ? Math.max(...times) : null,
    times,
    available: received > 0,
    error: received > 0 ? null : extractPingError(output)
  }
}

function extractPingError(output: string): string | null {
  if (/introuvable|could not find host|unknown host|name or service not known/i.test(output)) {
    return 'Hôte introuvable'
  }
  if (/inaccessible|unreachable/i.test(output)) return 'Hôte inaccessible'
  if (/100\s*%|perdus?\s*=\s*\d+\s*\(100/i.test(output)) return 'Aucune réponse'
  if (/expir|timed out|timeout|d[ée]lai/i.test(output)) return 'Délai dépassé'
  return null
}

/** Analyse d'une sortie `tracert` (Windows) ou `traceroute` (Unix). */
export function parseTracerouteOutput(output: string): {
  hop: number
  host: string | null
  rttMs: number | null
}[] {
  const hops: { hop: number; host: string | null; rttMs: number | null }[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const hopMatch = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!hopMatch) continue
    const hop = Number(hopMatch[1])
    if (!Number.isFinite(hop) || hop <= 0 || hop > 64) continue
    const rest = hopMatch[2]
    const ipMatch = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/.exec(rest)
    const rttMatch = /(?:<\s*)?(\d+(?:[.,]\d+)?)\s*ms/.exec(rest)
    const isStar = /^\s*\*/.test(rest) && !ipMatch
    if (isStar) {
      hops.push({ hop, host: null, rttMs: null })
      continue
    }
    hops.push({
      hop,
      host: ipMatch ? ipMatch[1] : null,
      rttMs: rttMatch ? Number(rttMatch[1].replace(',', '.')) : null
    })
  }
  return hops.sort((a, b) => a.hop - b.hop)
}
