import { isValidIPv4 } from '@shared/iputil'

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,62})(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,62}))*\.?$/

/**
 * Garde-fou : seules des adresses IPv4 ou des noms d'hôte simples sont
 * transmis aux commandes système. Aucune option, espace ou métacaractère.
 */
export function isSafeHost(host: string): boolean {
  if (!host || host.length > 253) return false
  if (isValidIPv4(host)) return true
  return HOSTNAME_RE.test(host)
}

export function isSafeInterfaceName(name: string): boolean {
  return /^[a-zA-Z0-9 ._:@-]{1,64}$/.test(name)
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
