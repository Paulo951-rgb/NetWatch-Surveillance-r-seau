import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  setData: (value: T | null) => void
}

/** Charge une donnée asynchrone et expose un rechargement manuel. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await loader()
      if (mounted.current) {
        setData(result)
        setError(null)
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Erreur inconnue')
    } finally {
      if (mounted.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload, setData }
}

/** Intervalle simple respectant le démontage. */
export function useInterval(callback: () => void, delay: number | null): void {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])
  useEffect(() => {
    if (delay === null || delay <= 0) return
    const timer = setInterval(() => saved.current(), delay)
    return () => clearInterval(timer)
  }, [delay])
}
