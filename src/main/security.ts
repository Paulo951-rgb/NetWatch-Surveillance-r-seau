import type { Session } from 'electron'

export interface SenderInfo {
  url: string
  isMainFrame: boolean
  webContentsId: number
}

export interface SenderPolicy {
  expectedWebContentsId: number | null
  devServerUrl?: string
}

export type SenderVerdict = { ok: true } | { ok: false; reason: string }

/** Seules l'application empaquetée (file://) et, en développement, le serveur Vite sont fiables. */
export function isTrustedUrl(url: string, devServerUrl?: string): boolean {
  if (!url) return false
  if (devServerUrl && (url === devServerUrl || url.startsWith(`${devServerUrl}/`))) return true
  // La fenêtre ne charge que nos propres fichiers ; tout autre schéma est refusé.
  return url.startsWith('file://')
}

export function checkSender(info: SenderInfo, policy: SenderPolicy): SenderVerdict {
  if (!info.isMainFrame) return { ok: false, reason: 'cadre imbriqué' }
  if (policy.expectedWebContentsId !== null && info.webContentsId !== policy.expectedWebContentsId) {
    return { ok: false, reason: 'fenêtre inconnue' }
  }
  if (!isTrustedUrl(info.url, policy.devServerUrl)) {
    return { ok: false, reason: `origine non autorisée (${info.url.slice(0, 80)})` }
  }
  return { ok: true }
}

/**
 * Défense en profondeur : l'interface n'a besoin d'aucune ressource distante, on refuse donc
 * toute permission et toute requête sortante émise depuis la session du renderer.
 */
export function hardenSession(session: Session, devServerUrl?: string): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))

  session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const local =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      (devServerUrl !== undefined &&
        (url.startsWith(devServerUrl) ||
          url.startsWith(devServerUrl.replace(/^http/, 'ws'))))

    if (!local) {
      callback({ cancel: true })
      return
    }
    callback({})
  })
}
