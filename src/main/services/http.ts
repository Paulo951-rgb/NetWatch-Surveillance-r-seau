import { get } from 'node:https'

/** Requête HTTPS minimale avec délai maximal. Aucune donnée n'est envoyée en POST. */
export function httpsGetJson(url: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { Accept: 'application/json', 'User-Agent': 'NetWatch' } }, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 64 * 1024) {
          request.destroy()
          reject(new Error('Réponse trop volumineuse'))
        }
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error('Réponse non JSON'))
        }
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Délai dépassé')))
  })
}
