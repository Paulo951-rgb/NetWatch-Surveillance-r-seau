import type {
  DiagnosticMetric,
  DiagnosticReport,
  DiagnosticResult,
  HopResult,
  NetworkInterfaceInfo,
  Settings,
  TracerouteResult
} from '@shared/types'
import { isPrivateIpv4, isValidIPv4, subnetOf } from '@shared/iputil'
import { anyTcpReachable } from '@shared/async'
import type { DiagnosticsRepository } from '../data/repositories/diagnostics'
import { listNetworkInterfaces } from './network-info'
import type { NetworkInfoService } from './network-info'
import type { PlatformAdapter } from './platform'
import type { Logger } from '../logger'

export interface DiagnosticsDeps {
  adapter: PlatformAdapter
  networkInfo: NetworkInfoService
  repo: DiagnosticsRepository
  getSettings: () => Settings
  logger: Logger
  now?: () => number
  reachable?: (targets: { host: string; port: number }[], timeoutMs: number) => Promise<boolean>
}

const DNS_TEST_NAMES = ['cloudflare.com', 'wikipedia.org', 'microsoft.com']

function metric(label: string, value: string): DiagnosticMetric {
  return { label, value }
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export class DiagnosticsService {
  private readonly now: () => number
  private lastReport: DiagnosticReport | null = null

  constructor(private readonly deps: DiagnosticsDeps) {
    this.now = deps.now ?? Date.now
  }

  getLastReport(): DiagnosticReport | null {
    return this.lastReport ?? this.deps.repo.last()
  }

  async interfaces(): Promise<NetworkInterfaceInfo[]> {
    return listNetworkInterfaces()
  }

  private async runSafely(
    key: string,
    label: string,
    worker: () => Promise<Omit<DiagnosticResult, 'key' | 'label' | 'durationMs'>>
  ): Promise<DiagnosticResult> {
    const startedAt = this.now()
    try {
      const result = await worker()
      return { key, label, durationMs: this.now() - startedAt, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      this.deps.logger.warn(`Diagnostic « ${key} » en échec`, error)
      return {
        key,
        label,
        status: 'error',
        summary: 'Test impossible',
        detail: message,
        explanation:
          'Ce test n’a pas pu être exécuté. Les outils réseau du système sont peut-être indisponibles ou bloqués par un antivirus.',
        metrics: [],
        durationMs: this.now() - startedAt
      }
    }
  }

  async testInterfaces(): Promise<DiagnosticResult> {
    return this.runSafely('interfaces', 'Interfaces réseau', async () => {
      const interfaces = await this.interfaces()
      const physical = interfaces.filter((entry) => !entry.virtual)
      const metrics = interfaces.slice(0, 8).map((entry) =>
        metric(
          entry.name,
          `${entry.address}${entry.cidr ? ` (${entry.cidr})` : ''}${entry.virtual ? ' · virtuelle' : ''}`
        )
      )
      if (interfaces.length === 0) {
        return {
          status: 'error',
          summary: 'Aucune interface réseau active',
          detail: 'Aucune adresse IPv4 non locale n’a été trouvée sur ce poste.',
          explanation:
            'Votre ordinateur ne dispose d’aucune connexion réseau active. Vérifiez le câble, le Wi-Fi ou la carte réseau.',
          metrics: []
        }
      }
      return {
        status: 'ok',
        summary: `${physical.length || interfaces.length} interface(s) active(s)`,
        detail: physical.map((entry) => `${entry.name} : ${entry.address}`).join(' · '),
        explanation: null,
        metrics
      }
    })
  }

  async testLocalConfiguration(): Promise<DiagnosticResult> {
    return this.runSafely('local-config', 'Configuration locale', async () => {
      const info = await this.deps.networkInfo.get()
      const metrics = [
        metric('Adresse IP locale', info.localIp ?? 'inconnue'),
        metric('Passerelle', info.gateway ?? 'inconnue'),
        metric('DNS', info.dns.length > 0 ? info.dns.join(', ') : 'non configurés'),
        metric('Type de connexion', info.connectionType === 'wifi' ? 'Wi-Fi' : info.connectionType === 'ethernet' ? 'Ethernet' : 'inconnu')
      ]
      if (!info.localIp) {
        return {
          status: 'error',
          summary: 'Aucune adresse IP locale',
          detail: 'Le poste n’a pas d’adresse IPv4.',
          explanation:
            'Sans adresse IP, l’ordinateur ne peut pas communiquer sur le réseau. Vérifiez que le Wi-Fi est activé ou que le câble est branché, puis relancez l’attribution automatique (DHCP).',
          metrics
        }
      }
      if (!isPrivateIpv4(info.localIp)) {
        return {
          status: 'warning',
          summary: 'Adresse IP hors plage privée',
          detail: `${info.localIp} n’appartient pas aux plages privées habituelles.`,
          explanation:
            'Une adresse publique directement sur le poste est inhabituelle. Vérifiez votre configuration : elle peut exposer l’ordinateur sur Internet.',
          metrics
        }
      }
      if (!info.gateway) {
        return {
          status: 'warning',
          summary: 'Aucune passerelle détectée',
          detail: 'La route par défaut est absente.',
          explanation:
            'Sans passerelle, seul le réseau local est accessible. La box ou le routeur est peut-être éteint, ou l’adresse est configurée manuellement sans passerelle.',
          metrics
        }
      }
      const sameSubnet = info.interfaces.some(
        (entry) => entry.address === info.localIp && info.gateway && subnetOf(info.gateway, entry.netmask) === subnetOf(entry.address, entry.netmask)
      )
      if (!sameSubnet) {
        return {
          status: 'warning',
          summary: 'Passerelle hors du sous-réseau',
          detail: `La passerelle ${info.gateway} n’est pas dans le même sous-réseau que ${info.localIp}.`,
          explanation:
            'La passerelle devrait se trouver dans le même sous-réseau que votre adresse. Cette configuration peut empêcher l’accès à Internet.',
          metrics
        }
      }
      return {
        status: 'ok',
        summary: 'Configuration réseau cohérente',
        detail: `${info.localIp} · passerelle ${info.gateway}`,
        explanation: null,
        metrics
      }
    })
  }

  async testGateway(): Promise<DiagnosticResult> {
    return this.runSafely('gateway', 'Passerelle', async () => {
      const info = await this.deps.networkInfo.get()
      if (!info.gateway || !isValidIPv4(info.gateway)) {
        return {
          status: 'skipped',
          summary: 'Aucune passerelle à tester',
          detail: null,
          explanation: 'La passerelle par défaut est inconnue : ce test ne peut pas être réalisé.',
          metrics: []
        }
      }
      const ping = await this.deps.adapter.ping(info.gateway, { count: 4, timeoutMs: 900 })
      const metrics = [
        metric('Passerelle', info.gateway),
        metric('Réponses', `${ping.received}/${ping.sent}`),
        metric('Latence moyenne', ping.rttMs !== null ? `${round(ping.rttMs)} ms` : '—'),
        metric('Perte', `${round(ping.lossPercent)} %`)
      ]
      if (ping.received === 0) {
        return {
          status: 'error',
          summary: 'Passerelle injoignable',
          detail: `Aucune réponse ICMP de ${info.gateway}.`,
          explanation:
            'Votre ordinateur ne parvient pas à joindre la box ou le routeur. Vérifiez le câble ou le Wi-Fi, redémarrez la box, et contrôlez que la passerelle indiquée correspond bien à votre matériel. Certains routeurs bloquent le ping : si Internet fonctionne, ce résultat peut être normal.',
          metrics
        }
      }
      if (ping.lossPercent > 0) {
        return {
          status: 'warning',
          summary: 'Passerelle joignable avec des pertes',
          detail: `${round(ping.lossPercent)} % de paquets perdus.`,
          explanation:
            'Des pertes vers la box indiquent souvent un problème de câble, de port ou une interférence Wi-Fi. Essayez un autre câble ou rapprochez-vous de la box.',
          metrics
        }
      }
      return {
        status: 'ok',
        summary: `Passerelle joignable en ${round(ping.rttMs ?? 0)} ms`,
        detail: `${ping.received}/${ping.sent} réponses`,
        explanation: null,
        metrics
      }
    })
  }

  async testDns(): Promise<DiagnosticResult> {
    return this.runSafely('dns', 'Résolution DNS', async () => {
      const results = []
      for (const name of DNS_TEST_NAMES) {
        results.push(await this.deps.adapter.resolveDns(name))
      }
      const succeeded = results.filter((entry) => entry.ok)
      const metrics = results.map((entry) =>
        metric(entry.name, entry.ok ? `${entry.addresses[0] ?? ''} · ${entry.durationMs} ms` : `échec (${entry.error ?? 'inconnu'})`)
      )
      const info = await this.deps.networkInfo.get()
      if (info.dns.length > 0) metrics.push(metric('Serveurs DNS', info.dns.join(', ')))
      if (succeeded.length === 0) {
        return {
          status: 'error',
          summary: 'Aucun nom de domaine résolu',
          detail: 'Les trois résolutions DNS ont échoué.',
          explanation:
            'Le DNS traduit les noms de sites en adresses IP. Sans lui, la navigation par nom échoue même si Internet fonctionne. Vérifiez les serveurs DNS de votre box, ou essayez 1.1.1.1 et 8.8.8.8.',
          metrics
        }
      }
      if (succeeded.length < results.length) {
        return {
          status: 'warning',
          summary: 'Résolution DNS partielle',
          detail: `${succeeded.length}/${results.length} noms résolus.`,
          explanation:
            'Certains noms ne se résolvent pas : le serveur DNS est lent, instable ou filtre les réponses. Testez avec un autre serveur DNS.',
          metrics
        }
      }
      const average = succeeded.reduce((sum, entry) => sum + entry.durationMs, 0) / succeeded.length
      return {
        status: average > 500 ? 'warning' : 'ok',
        summary: `DNS fonctionnel (${round(average, 0)} ms en moyenne)`,
        detail: `${succeeded.length}/${results.length} noms résolus`,
        explanation:
          average > 500
            ? 'La résolution est lente : les pages peuvent mettre du temps à s’afficher. Un serveur DNS plus proche améliorerait la situation.'
            : null,
        metrics
      }
    })
  }

  async testInternet(): Promise<DiagnosticResult> {
    return this.runSafely('internet', 'Connexion Internet', async () => {
      const reachable = this.deps.reachable ?? anyTcpReachable
      const tcpOk = await reachable(
        [
          { host: '1.1.1.1', port: 443 },
          { host: '8.8.8.8', port: 53 }
        ],
        2500
      )
      const dns = await this.deps.adapter.resolveDns('cloudflare.com')
      const metrics = [
        metric('Test TCP 1.1.1.1:443', tcpOk ? 'réussi' : 'échec'),
        metric('Résolution cloudflare.com', dns.ok ? 'réussie' : 'échec')
      ]
      if (tcpOk) {
        return {
          status: 'ok',
          summary: 'Internet accessible',
          detail: 'Connexion TCP établie vers un serveur public.',
          explanation: null,
          metrics
        }
      }
      if (dns.ok) {
        return {
          status: 'warning',
          summary: 'DNS disponible mais connexions bloquées',
          detail: 'Les noms se résolvent, mais aucune connexion TCP n’aboutit.',
          explanation:
            'Le filtrage ou le pare-feu bloque probablement les connexions sortantes. Vérifiez votre antivirus, votre pare-feu ou le filtrage de la box.',
          metrics
        }
      }
      return {
        status: 'error',
        summary: 'Pas d’accès à Internet',
        detail: 'Ni les connexions TCP ni le DNS n’ont abouti.',
        explanation:
          'Votre réseau local fonctionne peut-être, mais la box n’a pas de connexion Internet. Redémarrez la box, vérifiez le câble de la ligne et l’état des voyants.',
        metrics
      }
    })
  }

  async testLatency(): Promise<DiagnosticResult> {
    return this.runSafely('latency', 'Latence et gigue', async () => {
      const settings = this.deps.getSettings()
      const info = await this.deps.networkInfo.get()
      const target = settings.privacy.allowExternalPing ? '1.1.1.1' : info.gateway
      if (!target) {
        return {
          status: 'skipped',
          summary: 'Aucune cible disponible',
          detail: null,
          explanation:
            'Le test de latence nécessite une passerelle ou l’autorisation de contacter un serveur public.',
          metrics: []
        }
      }
      const ping = await this.deps.adapter.ping(target, { count: 10, timeoutMs: 1000 })
      if (ping.received === 0) {
        return {
          status: 'error',
          summary: `Aucune réponse de ${target}`,
          detail: `0/${ping.sent} paquets reçus.`,
          explanation:
            'Impossible de mesurer la latence. La cible est peut-être bloquée par un pare-feu, ou la connexion est interrompue.',
          metrics: [metric('Cible', target), metric('Perte', `${round(ping.lossPercent)} %`)]
        }
      }
      const jitter =
        ping.times.length > 1
          ? Math.sqrt(
              ping.times.reduce((sum, value) => sum + (value - (ping.rttMs ?? 0)) ** 2, 0) / ping.times.length
            )
          : 0
      const metrics = [
        metric('Cible', target),
        metric('Latence moyenne', `${round(ping.rttMs ?? 0)} ms`),
        metric('Minimum', `${round(ping.minMs ?? 0)} ms`),
        metric('Maximum', `${round(ping.maxMs ?? 0)} ms`),
        metric('Gigue', `${round(jitter)} ms`),
        metric('Perte', `${round(ping.lossPercent)} %`)
      ]
      const average = ping.rttMs ?? 0
      if (ping.lossPercent > 5 || average > 200) {
        return {
          status: 'error',
          summary: `Latence élevée (${round(average)} ms)`,
          detail: `${round(ping.lossPercent)} % de pertes, gigue de ${round(jitter)} ms.`,
          explanation:
            'Une latence élevée ou des pertes rendent la navigation et les visioconférences difficiles. Vérifiez le Wi-Fi, le câble, ou testez à un autre moment si votre connexion est partagée.',
          metrics
        }
      }
      if (average > 80 || ping.lossPercent > 0 || jitter > 30) {
        return {
          status: 'warning',
          summary: `Latence irrégulière (${round(average)} ms)`,
          detail: `Gigue de ${round(jitter)} ms, ${round(ping.lossPercent)} % de pertes.`,
          explanation:
            'La connexion est utilisable mais manque de régularité. Un Wi-Fi saturé ou une box surchargée explique souvent ce comportement.',
          metrics
        }
      }
      return {
        status: 'ok',
        summary: `Latence correcte (${round(average)} ms)`,
        detail: `Gigue de ${round(jitter)} ms, aucune perte.`,
        explanation: null,
        metrics
      }
    })
  }

  async testPacketLoss(): Promise<DiagnosticResult> {
    return this.runSafely('packet-loss', 'Pertes de paquets', async () => {
      const info = await this.deps.networkInfo.get()
      const target = info.gateway ?? (this.deps.getSettings().privacy.allowExternalPing ? '1.1.1.1' : null)
      if (!target) {
        return {
          status: 'skipped',
          summary: 'Aucune cible disponible',
          detail: null,
          explanation: 'Aucune passerelle ni autorisation de test externe : ce contrôle est ignoré.',
          metrics: []
        }
      }
      const ping = await this.deps.adapter.ping(target, { count: 10, timeoutMs: 1000 })
      const metrics = [
        metric('Cible', target),
        metric('Envoyés', String(ping.sent)),
        metric('Reçus', String(ping.received)),
        metric('Perte', `${round(ping.lossPercent)} %`)
      ]
      if (ping.lossPercent >= 50) {
        return {
          status: 'error',
          summary: `${round(ping.lossPercent)} % de paquets perdus`,
          detail: `Seulement ${ping.received}/${ping.sent} réponses de ${target}.`,
          explanation:
            'Une perte aussi élevée coupe pratiquement les communications. Changez de câble ou de canal Wi-Fi, et redémarrez la box.',
          metrics
        }
      }
      if (ping.lossPercent > 0) {
        return {
          status: 'warning',
          summary: `${round(ping.lossPercent)} % de paquets perdus`,
          detail: `${ping.received}/${ping.sent} réponses de ${target}.`,
          explanation:
            'Des pertes même faibles provoquent des saccades. Elles viennent souvent du Wi-Fi, d’un câble abîmé ou d’un lien saturé.',
          metrics
        }
      }
      return {
        status: 'ok',
        summary: 'Aucune perte de paquets',
        detail: `${ping.received}/${ping.sent} réponses de ${target}.`,
        explanation: null,
        metrics
      }
    })
  }

  async traceroute(target?: string, maxHops = 15): Promise<TracerouteResult> {
    const settings = this.deps.getSettings()
    const info = await this.deps.networkInfo.get()
    const destination = target && isValidIPv4(target) ? target : settings.privacy.allowExternalPing ? '1.1.1.1' : info.gateway
    if (!destination) {
      return {
        target: target ?? '',
        hops: [],
        reached: false,
        durationMs: 0,
        error: 'Aucune destination disponible'
      }
    }
    const startedAt = this.now()
    let hops: HopResult[] = []
    try {
      hops = await this.deps.adapter.traceroute(destination, { maxHops, timeoutMs: 800 })
    } catch (error) {
      return {
        target: destination,
        hops: [],
        reached: false,
        durationMs: this.now() - startedAt,
        error: error instanceof Error ? error.message : 'Traceroute indisponible'
      }
    }
    return {
      target: destination,
      hops,
      reached: hops.some((hop) => hop.host === destination),
      durationMs: this.now() - startedAt,
      error: hops.length === 0 ? 'Traceroute indisponible sur ce système' : null
    }
  }

  async testTraceroute(): Promise<DiagnosticResult> {
    return this.runSafely('traceroute', 'Traceroute', async () => {
      const result = await this.traceroute()
      if (result.hops.length === 0) {
        return {
          status: 'skipped',
          summary: 'Traceroute indisponible',
          detail: result.error,
          explanation:
            'L’outil de traçage n’est pas installé ou est bloqué. Le reste du diagnostic reste valable.',
          metrics: []
        }
      }
      const metrics = result.hops.slice(0, 12).map((hop) =>
        metric(`Saut ${hop.hop}`, `${hop.host ?? '*'}${hop.rttMs !== null ? ` · ${round(hop.rttMs)} ms` : ''}`)
      )
      metrics.push(metric('Destination', result.target))
      if (!result.reached) {
        return {
          status: 'warning',
          summary: 'Destination non atteinte',
          detail: `${result.hops.length} sauts, la destination ${result.target} n’a pas répondu.`,
          explanation:
            'Le trajet s’arrête avant la destination. Certains routeurs ne répondent pas au traçage, ce qui peut être normal. Si Internet fonctionne, ce résultat n’est pas alarmant.',
          metrics
        }
      }
      return {
        status: 'ok',
        summary: `Destination atteinte en ${result.hops.length} sauts`,
        detail: result.target,
        explanation: null,
        metrics
      }
    })
  }

  async runOne(key: string): Promise<DiagnosticResult> {
    switch (key) {
      case 'interfaces':
        return this.testInterfaces()
      case 'local-config':
        return this.testLocalConfiguration()
      case 'gateway':
        return this.testGateway()
      case 'dns':
        return this.testDns()
      case 'internet':
        return this.testInternet()
      case 'latency':
        return this.testLatency()
      case 'packet-loss':
        return this.testPacketLoss()
      case 'traceroute':
        return this.testTraceroute()
      default:
        return {
          key,
          label: 'Test inconnu',
          status: 'skipped',
          summary: 'Test non reconnu',
          detail: key,
          explanation: null,
          metrics: [],
          durationMs: 0
        }
    }
  }

  async runAll(): Promise<DiagnosticReport> {
    const startedAt = this.now()
    const keys = ['local-config', 'interfaces', 'gateway', 'dns', 'internet', 'latency', 'packet-loss', 'traceroute']
    const results: DiagnosticResult[] = []
    for (const key of keys) {
      results.push(await this.runOne(key))
    }
    const counted = results.filter((result) => result.status !== 'skipped')
    const ok = counted.filter((result) => result.status === 'ok').length
    const warnings = results.filter((result) => result.status === 'warning').length
    const problems = results.filter((result) => result.status === 'error').length
    const report: DiagnosticReport = {
      startedAt,
      finishedAt: this.now(),
      results,
      score: counted.length > 0 ? Math.round((ok / counted.length) * 100) : 0,
      problemCount: problems,
      warningCount: warnings
    }
    this.lastReport = report
    try {
      this.deps.repo.save(report)
    } catch (error) {
      this.deps.logger.warn('Enregistrement du diagnostic impossible', error)
    }
    return report
  }
}
