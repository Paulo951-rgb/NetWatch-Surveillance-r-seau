import { describe, expect, it } from 'vitest'
import { checkSender, isTrustedUrl } from '../src/main/security'

const DEV = 'http://localhost:5173'

describe('isTrustedUrl', () => {
  it('accepte les fichiers de l’application empaquetée', () => {
    expect(isTrustedUrl('file:///C:/Program%20Files/NetWatch/resources/app.asar/out/renderer/index.html')).toBe(
      true
    )
  })

  it('accepte le serveur de développement et ses sous-chemins', () => {
    expect(isTrustedUrl(DEV, DEV)).toBe(true)
    expect(isTrustedUrl(`${DEV}/src/main.tsx`, DEV)).toBe(true)
  })

  it('refuse une page distante, même si elle ressemble au serveur de développement', () => {
    expect(isTrustedUrl('https://example.com/', DEV)).toBe(false)
    expect(isTrustedUrl('http://localhost:5173.evil.tld/', DEV)).toBe(false)
    expect(isTrustedUrl('', DEV)).toBe(false)
  })
})

describe('checkSender', () => {
  const policy = { expectedWebContentsId: 7, devServerUrl: DEV }

  it('accepte le cadre principal de la bonne fenêtre', () => {
    expect(checkSender({ url: `${DEV}/index.html`, isMainFrame: true, webContentsId: 7 }, policy)).toEqual({
      ok: true
    })
  })

  it('refuse un cadre imbriqué (iframe publicitaire ou injectée)', () => {
    const verdict = checkSender({ url: `${DEV}/index.html`, isMainFrame: false, webContentsId: 7 }, policy)
    expect(verdict.ok).toBe(false)
  })

  it('refuse une autre fenêtre ou vue web', () => {
    const verdict = checkSender({ url: `${DEV}/index.html`, isMainFrame: true, webContentsId: 99 }, policy)
    expect(verdict.ok).toBe(false)
  })

  it('refuse une origine non autorisée', () => {
    const verdict = checkSender(
      { url: 'https://attaquant.example/', isMainFrame: true, webContentsId: 7 },
      policy
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('origine')
  })
})
