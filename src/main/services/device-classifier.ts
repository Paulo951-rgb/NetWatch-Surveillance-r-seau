import type { DeviceType } from '@shared/types'

export interface ClassifyInput {
  vendor?: string | null
  hostname?: string | null
  openPorts?: number[]
  isGateway?: boolean
}

const RULES: { type: DeviceType; patterns: RegExp[] }[] = [
  {
    type: 'printer',
    patterns: [/printer/i, /imprimante/i, /\bhp\b.*(laser|officejet|deskjet|envy)/i, /canon/i, /epson/i, /brother/i, /lexmark/i, /xerox/i, /kyocera/i, /ricoh/i]
  },
  {
    type: 'camera',
    patterns: [/hikvision/i, /dahua/i, /reolink/i, /ipcam/i, /ip camera/i, /wyze/i, /arlo/i, /blink/i, /axis communication/i, /amcrest/i, /camera/i]
  },
  {
    type: 'console',
    patterns: [/playstation/i, /xbox/i, /nintendo/i, /steam deck/i, /sony interactive/i]
  },
  {
    type: 'tv',
    patterns: [/bravia/i, /roku/i, /chromecast/i, /fire ?tv/i, /apple ?tv/i, /webos/i, /smart ?tv/i, /shield/i, /hisense/i, /tizen/i, /philips tv/i]
  },
  {
    type: 'speaker',
    patterns: [/sonos/i, /homepod/i, /echo/i, /alexa/i, /google home/i, /nest audio/i, /harman/i, /bose/i, /jbl/i]
  },
  {
    type: 'nas',
    patterns: [/synology/i, /qnap/i, /diskstation/i, /readynas/i, /drobo/i, /western digital.*(my cloud|nas)/i, /terramaster/i, /asustor/i]
  },
  {
    type: 'smartphone',
    patterns: [/iphone/i, /android/i, /redmi/i, /galaxy/i, /pixel/i, /oneplus/i, /xiaomi/i, /oppo/i, /vivo/i, /huawei p/i, /motorola/i, /smartphone/i]
  },
  {
    type: 'tablet',
    patterns: [/ipad/i, /tablet/i, /galaxy tab/i, /surface/i]
  },
  {
    type: 'router',
    patterns: [/tp-?link/i, /ubiquiti/i, /unifi/i, /mikrotik/i, /netgear/i, /d-?link/i, /linksys/i, /asus.*router/i, /router/i, /livebox/i, /freebox/i, /bbox/i, /sfr/i, /arris/i, /technicolor/i, /sagemcom/i, /zyxel/i, /avm gmbh/i, /fritz/i, /eero/i, /deco/i, /orbi/i, /access point/i]
  },
  {
    type: 'computer',
    patterns: [/desktop/i, /laptop/i, /notebook/i, /macbook/i, /imac/i, /thinkpad/i, /latitude/i, /elitebook/i, /surface pro/i, /pc-/i, /ordinateur/i, /workstation/i, /raspberry pi/i, /intel corporate/i, /dell inc/i, /lenovo/i, /hewlett/i, /micro-star/i, /asustek/i, /gigabyte/i]
  },
  {
    type: 'iot',
    patterns: [/espressif/i, /shelly/i, /tuya/i, /sonoff/i, /smart ?plug/i, /thermostat/i, /nest/i, /philips hue/i, /signify/i, /aqara/i, /lifx/i, /tasmota/i, /zigbee/i, /arduino/i, /particle/i, /wemo/i, /meross/i, /domoticz/i]
  }
]

const PRINTER_PORTS = [631, 515, 9100]
const CAMERA_PORTS = [554, 8000, 8554]
const COMPUTER_PORTS = [3389, 445, 139, 548]

/**
 * Estimation du type d'appareil à partir du fabricant, du nom d'hôte et des
 * ports ouverts. Le résultat est indicatif : il ne s'agit pas d'une preuve.
 */
export function classifyDevice(input: ClassifyInput): DeviceType {
  if (input.isGateway) return 'router'
  const ports = input.openPorts ?? []
  const hostname = (input.hostname ?? '').toLowerCase()
  const vendor = (input.vendor ?? '').toLowerCase()
  const haystack = `${hostname} ${vendor}`.trim()

  if (PRINTER_PORTS.some((port) => ports.includes(port))) return 'printer'
  if (ports.includes(554) || ports.includes(8554)) return 'camera'

  if (haystack) {
    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(haystack))) return rule.type
    }
  }

  if (CAMERA_PORTS.some((port) => ports.includes(port))) return 'camera'
  if (COMPUTER_PORTS.some((port) => ports.includes(port))) return 'computer'
  return 'unknown'
}
