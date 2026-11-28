import { describe, expect, it } from 'vitest'
import { asBool, asEnum, asHost, asInt, asString } from '../src/main/validation'

describe('asString', () => {
  it('nettoie et tronque', () => {
    expect(asString('  Salon  ', 20)).toBe('Salon')
    expect(asString('a'.repeat(50), 8)).toHaveLength(8)
  })

  it('refuse les types inattendus', () => {
    expect(asString(42, 10)).toBe('')
    expect(asString(null, 10, 'défaut')).toBe('défaut')
    expect(asString('   ', 10, 'défaut')).toBe('défaut')
  })
})

describe('asInt', () => {
  it('borne les valeurs', () => {
    expect(asInt(500, 1, 100, 10)).toBe(100)
    expect(asInt(-3, 0, 100, 10)).toBe(0)
    expect(asInt('42', 0, 100, 10)).toBe(42)
    expect(asInt(3.7, 0, 100, 10)).toBe(4)
  })

  it('retombe sur le défaut pour NaN ou objet', () => {
    expect(asInt(Number.NaN, 0, 100, 7)).toBe(7)
    expect(asInt({}, 0, 100, 7)).toBe(7)
  })
})

describe('asBool / asEnum', () => {
  it('ne convertit pas les chaînes en booléen', () => {
    expect(asBool('true', false)).toBe(false)
    expect(asBool(true, false)).toBe(true)
  })

  it('limite aux valeurs autorisées', () => {
    expect(asEnum('json', ['csv', 'json'] as const, 'csv')).toBe('json')
    expect(asEnum('exe', ['csv', 'json'] as const, 'csv')).toBe('csv')
  })
})

describe('asHost', () => {
  it('accepte IPv4, CIDR privé et nom DNS', () => {
    expect(asHost('192.168.1.10')).toBe('192.168.1.10')
    expect(asHost('192.168.1.0/24')).toBe('192.168.1.0/24')
    expect(asHost('Box.Local')).toBe('box.local')
  })

  it('refuse les injections et plages trop larges', () => {
    expect(asHost('192.168.1.1; rm -rf /')).toBeUndefined()
    expect(asHost('192.168.1.1/8')).toBeUndefined()
    expect(asHost('999.1.1.1')).toBeUndefined()
    expect(asHost('')).toBeUndefined()
    expect(asHost('a'.repeat(80))).toBeUndefined()
  })
})
