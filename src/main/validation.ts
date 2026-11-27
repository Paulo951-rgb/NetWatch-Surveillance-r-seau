/**
 * Validation des charges utiles IPC.
 *
 * Le processus principal ne fait jamais confiance au renderer : chaque valeur est ramenée
 * à un type, une longueur et un intervalle connus avant d'atteindre un service système.
 */

export function asString(value: unknown, maxLength: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, maxLength)
}

export function asInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** Hôte réseau sûr : adresse IPv4, nom DNS court ou plage CIDR privée. */
export function asHost(value: unknown): string | undefined {
  const raw = asString(value, 64)
  if (!raw) return undefined
  if (IPV4.test(raw)) return raw
  const cidr = raw.split('/')
  if (cidr.length === 2 && IPV4.test(cidr[0]) && /^\d{1,2}$/.test(cidr[1])) {
    const prefix = Number(cidr[1])
    return prefix >= 16 && prefix <= 32 ? `${cidr[0]}/${prefix}` : undefined
  }
  // Une suite de chiffres et de points qui n'est pas une IPv4 valide n'est pas un nom d'hôte.
  if (/^[\d.]+$/.test(raw)) return undefined
  if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(raw)) {
    return raw.toLowerCase()
  }
  return undefined
}
