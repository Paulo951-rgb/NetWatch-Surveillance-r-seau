import { readFileSync } from 'node:fs'
import { normalizeMac } from '@shared/iputil'

export type OuiRegistry = Record<string, string>

/** Base locale fabricant <- préfixe MAC (3 octets). Aucun appel réseau. */
export class OuiDatabase {
  private readonly registry: OuiRegistry

  constructor(registry: OuiRegistry = {}) {
    this.registry = registry
  }

  static load(filePath: string): OuiDatabase {
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as OuiRegistry
      return new OuiDatabase(parsed)
    } catch {
      return new OuiDatabase({})
    }
  }

  get size(): number {
    return Object.keys(this.registry).length
  }

  lookup(mac: string | null | undefined): string | null {
    const normalized = normalizeMac(mac)
    if (!normalized) return null
    const prefix = normalized.slice(0, 8).replace(/:/g, '').toUpperCase()
    return this.registry[prefix] ?? null
  }
}
