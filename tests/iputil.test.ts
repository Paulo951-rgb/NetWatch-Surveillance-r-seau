import { describe, expect, it } from 'vitest'
import {
  cidrToRange,
  guessScanRange,
  intToIpv4,
  ipInSubnet,
  ipv4ToInt,
  isLocallyAdministeredMac,
  isMulticastMac,
  isPrivateIpv4,
  isSpecialIpv4,
  isValidCidr,
  isValidIPv4,
  isValidMac,
  macToLinkLocalIpv6,
  netmaskToPrefix,
  normalizeMac,
  prefixToNetmask,
  sortIpv4,
  subnetOf
} from '@shared/iputil'

describe('validation IPv4', () => {
  it('accepte les adresses valides', () => {
    for (const ip of ['0.0.0.0', '192.168.1.1', '255.255.255.255', '10.0.0.254']) {
      expect(isValidIPv4(ip)).toBe(true)
    }
  })

  it('rejette les adresses invalides', () => {
    for (const ip of ['', '192.168.1', '192.168.1.256', '1.2.3.4.5', 'abc', '1.2.3.-1', ' 1.2.3.4']) {
      expect(isValidIPv4(ip)).toBe(false)
    }
  })

  it('convertit dans les deux sens sans perte de signe', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0)
    expect(ipv4ToInt('255.255.255.255')).toBe(4294967295)
    expect(ipv4ToInt('192.168.1.10')).toBe(3232235786)
    expect(intToIpv4(3232235786)).toBe('192.168.1.10')
    expect(intToIpv4(4294967295)).toBe('255.255.255.255')
  })
})

describe('masques et CIDR', () => {
  it('convertit masque <-> préfixe', () => {
    expect(netmaskToPrefix('255.255.255.0')).toBe(24)
    expect(netmaskToPrefix('255.255.0.0')).toBe(16)
    expect(prefixToNetmask(24)).toBe('255.255.255.0')
    expect(prefixToNetmask(30)).toBe('255.255.255.252')
  })

  it('décompose un /24 en 254 hôtes', () => {
    const range = cidrToRange('192.168.1.0/24')
    expect(range).not.toBeNull()
    expect(range?.first).toBe('192.168.1.1')
    expect(range?.last).toBe('192.168.1.254')
    expect(range?.hostCount).toBe(254)
    expect(range?.hosts).toHaveLength(254)
    expect(range?.hosts[0]).toBe('192.168.1.1')
  })

  it('limite le nombre d hôtes demandé', () => {
    const range = cidrToRange('10.0.0.0/16', 10)
    expect(range?.hosts).toHaveLength(10)
    expect(range?.hostCount).toBe(65534)
  })

  it('rejette les CIDR invalides', () => {
    expect(isValidCidr('192.168.1.0/33')).toBe(false)
    expect(isValidCidr('192.168.1.0')).toBe(false)
    expect(isValidCidr('nope/24')).toBe(false)
    expect(isValidCidr('192.168.1.0/24')).toBe(true)
  })

  it('calcule sous-réseau et appartenance', () => {
    expect(subnetOf('192.168.1.77', '255.255.255.0')).toBe('192.168.1.0')
    expect(ipInSubnet('192.168.1.77', '192.168.1.0', '255.255.255.0')).toBe(true)
    expect(ipInSubnet('192.168.2.77', '192.168.1.0', '255.255.255.0')).toBe(false)
  })

  it('choisit une plage /24 même si le masque est plus large', () => {
    expect(guessScanRange('192.168.1.10', '255.255.255.0')).toBe('192.168.1.0/24')
    expect(guessScanRange('10.1.2.3', '255.0.0.0')).toBe('10.1.2.0/24')
    expect(guessScanRange('192.168.1.10', '255.255.255.252')).toBe('192.168.1.8/30')
    expect(guessScanRange('192.168.1.10', '0.0.0.0')).toBeNull()
  })
})

describe('adresses privées et spéciales', () => {
  it('identifie les plages privées', () => {
    for (const ip of ['10.0.0.1', '172.16.5.4', '172.31.255.1', '192.168.0.1', '100.64.1.1', '169.254.1.1']) {
      expect(isPrivateIpv4(ip)).toBe(true)
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '11.0.0.1']) {
      expect(isPrivateIpv4(ip)).toBe(false)
    }
  })

  it('détecte les adresses non scannables', () => {
    expect(isSpecialIpv4('127.0.0.1')).toBe(true)
    expect(isSpecialIpv4('224.0.0.1')).toBe(true)
    expect(isSpecialIpv4('255.255.255.255')).toBe(true)
    expect(isSpecialIpv4('192.168.1.0')).toBe(true)
    expect(isSpecialIpv4('192.168.1.255')).toBe(true)
    expect(isSpecialIpv4('192.168.1.10')).toBe(false)
  })

  it('trie les adresses numériquement', () => {
    expect(sortIpv4(['192.168.1.100', '192.168.1.9', '192.168.1.20'])).toEqual([
      '192.168.1.9',
      '192.168.1.20',
      '192.168.1.100'
    ])
  })
})

describe('adresses MAC', () => {
  it('valide et normalise', () => {
    expect(isValidMac('B4-2E-99-1A-2B-3C')).toBe(true)
    expect(isValidMac('b4:2e:99:1a:2b:3c')).toBe(true)
    expect(isValidMac('b4:2e:99')).toBe(false)
    expect(normalizeMac('B4-2E-99-1A-2B-3C')).toBe('b4:2e:99:1a:2b:3c')
    expect(normalizeMac('invalide')).toBe('')
  })

  it('distingue multicast et administration locale', () => {
    expect(isMulticastMac('01:00:5e:00:00:16')).toBe(true)
    expect(isMulticastMac('b4:2e:99:1a:2b:3c')).toBe(false)
    expect(isLocallyAdministeredMac('02:00:00:00:00:01')).toBe(true)
    expect(isLocallyAdministeredMac('b4:2e:99:1a:2b:3c')).toBe(false)
  })

  it('convertit en adresse link-local IPv6 (EUI-64)', () => {
    expect(macToLinkLocalIpv6('b4:2e:99:1a:2b:3c')).toBe('fe80::b62e:99ff:fe1a:2b3c')
  })
})
