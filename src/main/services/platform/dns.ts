import { promises as dns } from 'node:dns'
import type { DnsTestResult } from './types'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Délai DNS dépassé')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Résolution directe (A) via le résolveur du système, fichiers hosts compris. */
export async function resolveDnsName(name: string, timeoutMs = 4000): Promise<DnsTestResult> {
  const startedAt = Date.now()
  try {
    const looked = await withTimeout(dns.lookup(name, { all: true, family: 4 }), timeoutMs)
    const addresses = looked.map((entry) => entry.address).filter((value) => typeof value === 'string')
    if (addresses.length > 0) {
      return { ok: true, name, addresses, durationMs: Date.now() - startedAt, error: null }
    }
  } catch {
    // le résolveur système a échoué : on tente une requête DNS directe
  }
  try {
    const addresses = await withTimeout(dns.resolve4(name), timeoutMs)
    return {
      ok: true,
      name,
      addresses,
      durationMs: Date.now() - startedAt,
      error: null
    }
  } catch (error) {
    return {
      ok: false,
      name,
      addresses: [],
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Échec de la résolution'
    }
  }
}

/** Résolution inverse (PTR) avec délai maximal. */
export async function reverseLookup(ip: string, timeoutMs = 1500): Promise<string | null> {
  try {
    const names = await withTimeout(dns.reverse(ip), timeoutMs)
    const name = names.find((value) => value && value.length > 0)
    if (!name) return null
    return name.replace(/\.$/, '')
  } catch {
    return null
  }
}
