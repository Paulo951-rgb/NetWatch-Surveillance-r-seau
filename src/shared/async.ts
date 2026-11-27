/** Utilitaires asynchrones partagés (testables). */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Exécute `worker` sur chaque élément avec une limite de parallélisme.
 * Conserve l'ordre des résultats et ne rejette jamais : les erreurs sont
 * transmises au callback `onError` (par défaut ignorées).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onError?: (error: unknown, item: T) => void
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length)
  const max = Math.max(1, Math.trunc(limit))
  let cursor = 0

  async function run(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        results[index] = undefined
        onError?.(error, items[index])
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(max, items.length) }, () => run()))
  return results
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Délai dépassé'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
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

/** Mesure le temps d'établissement d'une connexion TCP (sans échange de données). */
export async function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<number | null> {
  const { connect } = await import('node:net')
  return new Promise<number | null>((resolve) => {
    const startedAt = Date.now()
    let settled = false
    const socket = connect({ host, port })
    const finish = (value: number | null): void => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(Date.now() - startedAt))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
  })
}

/** Vrai si au moins un des hôtes/ports répond (test de disponibilité). */
export async function anyTcpReachable(
  targets: { host: string; port: number }[],
  timeoutMs = 1500
): Promise<boolean> {
  const results = await Promise.all(targets.map((target) => tcpProbe(target.host, target.port, timeoutMs)))
  return results.some((value) => value !== null)
}
