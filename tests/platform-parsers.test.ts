import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePingOutput, parseTracerouteOutput } from '../src/main/services/platform/parsers/ping'
import {
  parseArpWindows,
  parseNetAdapterStatistics,
  parseNetIpConfiguration,
  parseNetshDns,
  parseNetshWifiSsid,
  parseNetstatE,
  parseNetstatWindows,
  parsePowerShellJson,
  parseProcessJson,
  parseRoutePrintDefault,
  parseTasklistCsv,
  splitHostPort
} from '../src/main/services/platform/parsers/windows'
import {
  parseArpBsd,
  parseIpNeigh,
  parseIpRouteDefault,
  parseMacRouteDefault,
  parseNetstatBsd,
  parseNetstatIBN,
  parseProcNetDev,
  parseResolvConf,
  parseScutilDns,
  parseSsOutput
} from '../src/main/services/platform/parsers/unix'

const fixture = (path: string): string => readFileSync(resolve(__dirname, 'fixtures', path), 'utf8')

describe('Windows : arp -a', () => {
  it('extrait les couples IP/MAC de chaque interface', () => {
    const entries = parseArpWindows(fixture('windows/arp-a.txt'))
    expect(entries).toHaveLength(7)
    expect(entries[0]).toEqual({ ip: '192.168.1.1', mac: 'b4:2e:99:1a:2b:3c', iface: '192.168.1.10' })
    expect(entries[6]).toEqual({ ip: '10.0.0.1', mac: 'aa:bb:cc:dd:ee:ff', iface: '10.0.0.5' })
  })

  it('fonctionne aussi avec une sortie anglaise', () => {
    const entries = parseArpWindows(fixture('windows/arp-a-en.txt'))
    expect(entries).toHaveLength(2)
    expect(entries[1].mac).toBe('3c:22:fb:aa:bb:cc')
  })

  it('ignore les lignes inexploitables', () => {
    expect(parseArpWindows('Interface : 192.168.1.10 --- 0x6\n  Internet Address      Physical Address      Type\n')).toEqual([])
  })
})

describe('Windows : netstat -ano', () => {
  const connections = parseNetstatWindows(fixture('windows/netstat-ano.txt'))

  it('lit toutes les connexions TCP et UDP', () => {
    expect(connections).toHaveLength(11)
  })

  it('découpe correctement adresses et ports', () => {
    const https = connections.find((c) => c.remotePort === 443 && c.protocol === 'TCP')
    expect(https).toBeDefined()
    expect(https?.localAddress).toBe('192.168.1.10')
    expect(https?.localPort).toBe(49732)
    expect(https?.remoteAddress).toBe('93.184.216.34')
    expect(https?.state).toBe('ESTABLISHED')
    expect(https?.pid).toBe(8124)
  })

  it('gère les adresses IPv6 et les lignes UDP sans état', () => {
    const ipv6 = connections.find((c) => c.localAddress === '::')
    expect(ipv6?.localPort).toBe(135)
    const scoped = connections.find((c) => c.localPort === 1900)
    expect(scoped?.localAddress).toBe('fe80::1c2a:8bff:fe9d:1234%12')
    const udp = connections.find((c) => c.protocol === 'UDP' && c.localPort === 500)
    expect(udp?.remoteAddress).toBe('*')
    expect(udp?.pid).toBe(1208)
  })

  it('découpe les jetons hôte:port', () => {
    expect(splitHostPort('0.0.0.0:0')).toEqual({ address: '0.0.0.0', port: 0 })
    expect(splitHostPort('[::]:80')).toEqual({ address: '::', port: 80 })
    expect(splitHostPort('*:*')).toEqual({ address: '*', port: 0 })
  })
})

describe('Windows : informations réseau', () => {
  it('lit route print', () => {
    expect(parseRoutePrintDefault(fixture('windows/route-print.txt'))).toEqual({
      gateway: '192.168.1.1',
      localIp: '192.168.1.10',
      interfaceIndex: '25'
    })
  })

  it('lit les DNS netsh', () => {
    expect(parseNetshDns(fixture('windows/netsh-dns.txt'))).toEqual(['192.168.1.1', '8.8.8.8'])
  })

  it('lit Get-NetIPConfiguration', () => {
    const configs = parseNetIpConfiguration(fixture('windows/ps-netipconfig.json'))
    expect(configs).toHaveLength(1)
    expect(configs[0]).toEqual({
      interfaceAlias: 'Ethernet',
      ipv4: '192.168.1.10',
      gateway: '192.168.1.1',
      dns: ['192.168.1.1', '8.8.8.8']
    })
  })

  it('lit les statistiques d adaptateur', () => {
    const counters = parseNetAdapterStatistics(fixture('windows/ps-adapter-stats.json'))
    expect(counters).toEqual([
      { name: 'Ethernet', rxBytes: 12345678901, txBytes: 987654321 },
      { name: 'Wi-Fi', rxBytes: 1000, txBytes: 2000 }
    ])
  })

  it('lit netstat -e en secours', () => {
    expect(parseNetstatE(fixture('windows/netstat-e.txt'))).toEqual({
      rxBytes: 12345678901,
      txBytes: 987654321
    })
  })

  it('lit les noms de processus', () => {
    const ps = parseProcessJson(fixture('windows/ps-processes.json'))
    expect(ps.get(8124)).toBe('chrome.exe')
    expect(ps.get(4)).toBe('System.exe')
    const tasklist = parseTasklistCsv(fixture('windows/tasklist.csv'))
    expect(tasklist.get(3100)).toBe('Code.exe')
  })

  it('lit le SSID Wi-Fi', () => {
    expect(parseNetshWifiSsid(fixture('windows/netsh-wlan.txt'))).toBe('Maison-5G')
  })

  it('tolère un objet JSON unique ou un tableau', () => {
    expect(parsePowerShellJson('{"a":1}')).toEqual([{ a: 1 }])
    expect(parsePowerShellJson('[{"a":1},{"b":2}]')).toHaveLength(2)
    expect(parsePowerShellJson('')).toEqual([])
    expect(parsePowerShellJson('sortie non json')).toEqual([])
  })
})

describe('Windows : ping et tracert', () => {
  it('analyse un ping réussi en français', () => {
    const result = parsePingOutput(fixture('windows/ping-fr-ok.txt'), '192.168.1.1', 4)
    expect(result.received).toBe(4)
    expect(result.lossPercent).toBe(0)
    expect(result.available).toBe(true)
    expect(result.times).toEqual([1, 0.5, 3, 2])
    expect(result.minMs).toBe(0.5)
    expect(result.maxMs).toBe(3)
    expect(result.rttMs).toBeCloseTo(1.625, 3)
  })

  it('analyse un ping en échec', () => {
    const result = parsePingOutput(fixture('windows/ping-fr-timeout.txt'), '8.8.8.8', 2)
    expect(result.received).toBe(0)
    expect(result.lossPercent).toBe(100)
    expect(result.available).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('analyse un ping anglais', () => {
    const result = parsePingOutput(fixture('windows/ping-en-ok.txt'), '8.8.8.8', 2)
    expect(result.received).toBe(2)
    expect(result.rttMs).toBeCloseTo(11.5, 3)
  })

  it('analyse tracert avec sauts muets', () => {
    const hops = parseTracerouteOutput(fixture('windows/tracert-fr.txt'))
    expect(hops).toHaveLength(4)
    expect(hops[0]).toEqual({ hop: 1, host: '192.168.1.1', rttMs: 1 })
    expect(hops[1]).toEqual({ hop: 2, host: null, rttMs: null })
    expect(hops[3].host).toBe('8.8.8.8')
  })
})

describe('Linux : analyseurs', () => {
  it('lit /proc/net/dev', () => {
    const counters = parseProcNetDev(fixture('linux/proc-net-dev.txt'))
    expect(counters).toHaveLength(3)
    expect(counters.find((c) => c.name === 'eth0')).toEqual({
      name: 'eth0',
      rxBytes: 9876543210,
      txBytes: 1234567890
    })
    expect(counters.find((c) => c.name === 'lo')?.rxBytes).toBe(1234567)
  })

  it('lit ip neigh en ignorant les échecs', () => {
    const entries = parseIpNeigh(fixture('linux/ip-neigh.txt'))
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({ ip: '192.168.1.1', mac: 'b4:2e:99:1a:2b:3c', iface: 'eth0' })
  })

  it('lit ss avec processus', () => {
    const connections = parseSsOutput(fixture('linux/ss.txt'))
    expect(connections).toHaveLength(5)
    expect(connections[0].pid).toBe(1234)
    expect(connections[0].processName).toBe('sshd')
    expect(connections[0].state).toBe('ESTAB')
    const mapped = connections.find((c) => c.localPort === 443)
    expect(mapped?.localAddress).toBe('::ffff:192.168.1.10')
  })

  it('gère ss sans droits sur les processus', () => {
    const connections = parseSsOutput(fixture('linux/ss-no-process.txt'))
    expect(connections).toHaveLength(2)
    expect(connections[0].pid).toBeNull()
    expect(connections[0].processName).toBeNull()
  })

  it('lit la route par défaut et les DNS', () => {
    expect(parseIpRouteDefault('default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.10 metric 100')).toEqual({
      gateway: '192.168.1.1',
      iface: 'eth0',
      src: '192.168.1.10'
    })
    expect(parseResolvConf('nameserver 192.168.1.1\nnameserver 8.8.8.8\n# commentaire')).toEqual([
      '192.168.1.1',
      '8.8.8.8'
    ])
  })

  it('analyse un ping Linux', () => {
    const ok = parsePingOutput(fixture('linux/ping-ok.txt'), '127.0.0.1', 3)
    expect(ok.received).toBe(3)
    expect(ok.rttMs).toBeCloseTo(0.048, 3)
    const ko = parsePingOutput(fixture('linux/ping-timeout.txt'), '192.0.2.1', 2)
    expect(ko.received).toBe(0)
    expect(ko.lossPercent).toBe(100)
  })
})

describe('macOS : analyseurs', () => {
  it('lit netstat -ibn', () => {
    const counters = parseNetstatIBN(fixture('darwin/netstat-ibn.txt'))
    expect(counters.find((c) => c.name === 'en0')).toEqual({
      name: 'en0',
      rxBytes: 9876543210,
      txBytes: 1234567890
    })
    expect(counters.find((c) => c.name === 'lo0')?.rxBytes).toBe(12345678)
  })

  it('lit netstat -anv tcp et udp avec PID', () => {
    const tcp = parseNetstatBsd(fixture('darwin/netstat-anv-tcp.txt'))
    expect(tcp).toHaveLength(2)
    expect(tcp[0].pid).toBe(8124)
    expect(tcp[0].remoteAddress).toBe('93.184.216.34')
    expect(tcp[0].remotePort).toBe(443)
    expect(tcp[1].localAddress).toBe('*')
    expect(tcp[1].localPort).toBe(22)
    const udp = parseNetstatBsd(fixture('darwin/netstat-anv-udp.txt'))
    expect(udp[0].pid).toBe(5604)
  })

  it('lit arp -an et la route par défaut', () => {
    expect(parseArpBsd(fixture('darwin/arp-an.txt'))).toHaveLength(3)
    expect(parseMacRouteDefault('   route to: default\ndestination: default\n    gateway: 192.168.1.1\n  interface: en0\n')).toEqual({
      gateway: '192.168.1.1',
      iface: 'en0'
    })
    expect(parseScutilDns('resolver #1\n  nameserver[0] : 192.168.1.1\n  nameserver[1] : 8.8.8.8')).toEqual([
      '192.168.1.1',
      '8.8.8.8'
    ])
  })
})
